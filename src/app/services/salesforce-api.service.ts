import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, of, switchMap, tap, catchError, throwError, map, forkJoin } from 'rxjs'; // Add throwError

import { ContextService } from './context.service';
import { ToastService } from './toast.service';

declare const Visualforce: any;

@Injectable({
    providedIn: 'root'
})
export class SalesforceApiService {
    private http = inject(HttpClient);
    private contextService = inject(ContextService);
    private toastService = inject(ToastService);

    constructor() {
        console.log('🔄 SalesforceApiService: Service Initialized (Real API Environment)');
    }

    private handleError(method: string, err: any): Observable<never> {
        console.error(`[API Error] ${method}`, err);
        let msg = 'Unknown Error';
        if (err.error) {
            msg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
        } else if (err.message) {
            msg = err.message;
        }
        this.toastService.show(`API Error (${method}): ${msg}`, 'error');
        return throwError(() => err);
    }

    /**
     * Calls the Salesforce backend via Visualforce Remoting
     */
    placeOrder(payload: any): Observable<any> {
        const method = 'SalesforceApiService.placeOrder';
        console.log(`[API Request] ${method}`, { payload });

        return new Observable(observer => {
            // Mock for local development
            if (!window.SF_CONTEXT && !((window as any).Visualforce)) {
                console.warn(`[API Warn] ${method} Mocking API Call (Local Dev)`);
                setTimeout(() => {
                    const response = { success: true, orderId: 'MOCK-ORDER-123' };
                    console.log(`[API Response] ${method}`, response);
                    observer.next(response);
                    observer.complete();
                }, 1000);
                return;
            }

            // Real Salesforce Call
            Visualforce.remoting.Manager.invokeAction(
                'QuoteController.placeOrder',
                payload,
                (result: any, event: any) => {
                    if (event.status) {
                        console.log(`[API Response] ${method}`, result);
                        observer.next(result);
                        observer.complete();
                    } else {
                        const msg = event.message || 'Visualforce Remote Action Failed';
                        this.toastService.show(`Error: ${msg}`, 'error');
                        observer.error(event);
                    }
                },
                { escape: false }
            );
        });
    }

    /**
     * Fetches opportunity details from Salesforce REST API
     * @param opportunityId The Salesforce Opportunity ID
     * @returns Observable of opportunity details
     */
    getOpportunityDetails(opportunityId: string): Observable<any> {
        const method = 'SalesforceApiService.getOpportunityDetails';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const query = `SELECT Id, Name, AccountId, Account.Name, Account.Website, Pricebook2Id, Primary_Contact__c, Sales_Channel__c, (SELECT Contact.Name FROM OpportunityContactRoles WHERE IsPrimary = true) FROM Opportunity WHERE Id = '${opportunityId}'`;
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v65.0/query/?q=${encodedQuery}`;

        console.log(`[API Request] ${method}`, { url, query });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            map((res: any) => res.records && res.records.length > 0 ? res.records[0] : null),
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Fetches the ContextMapping ID for QuoteEntitiesMapping
     */
    getContextMappingId(): Observable<string | null> {
        const method = 'SalesforceApiService.getContextMappingId';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const query = "SELECT Id,Title,ContextDefinitionVersionId,IsDefault,CreatedDate FROM ContextMapping WHERE Title='QuoteEntitiesMapping' AND ContextDefinitionVersionId='11pDz000000000LIAQ'";
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v60.0/query/?q=${encodedQuery}`;

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            map((res: any) => (res.records && res.records.length > 0) ? res.records[0].Id : null),
            tap(id => console.log(`[API Response] ${method} Found ID:`, id)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Initializes a CPQ configurator instance
     */
    setInstance(contextMappingId: string, quoteId: string): Observable<any> {
        const method = 'SalesforceApiService.setInstance';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v66.0/connect/cpq/configurator/actions/set-instance`;

        const payload = {
            "configuratorOptions": {
                "addDefaultConfiguration": false,
                "executeConfigurationRules": false,
                "executePricing": false,
                "qualifyAllProductsInTransaction": false,
                "validateAmendRenewCancel": false,
                "validateProductCatalog": false
            },
            "contextMappingId": contextMappingId,
            "transaction": JSON.stringify({
                "Quote": [{ "id": quoteId, "businessObjectType": "Quote" }]
            })
        };

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, payload, { headers }).pipe(
            tap(res => console.log(`[API Response] ${method}`, res)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Adds nodes (QuoteLineItems, Commitments, etc.) to a CPQ configurator instance
     */
    addNodes(contextId: string, addedNodes: any[]): Observable<any> {
        const method = 'SalesforceApiService.addNodes';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v66.0/connect/cpq/configurator/actions/add-nodes`;

        const payload = {
            "configuratorOptions": {
                "executePricing": true,
                "addDefaultConfiguration": false,
                "executeConfigurationRules": true
            },
            "contextId": contextId,
            "addedNodes": addedNodes
        };

        console.log(`[API Request] ${method}`, JSON.stringify(payload, null, 2));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, payload, { headers }).pipe(
            tap(res => console.log(`[API Response] ${method}`, res)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Saves a CPQ configurator instance
     */
    saveInstance(contextId: string): Observable<any> {
        const method = 'SalesforceApiService.saveInstance';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v66.0/connect/cpq/configurator/actions/save-instance`;

        const payload = { "contextId": contextId };

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, payload, { headers }).pipe(
            tap(res => console.log(`[API Response] ${method}`, res)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches account details from Salesforce REST API
     * @param accountId The Salesforce Account ID
     * @returns Observable of account details
     */
    getAccountDetails(accountId: string): Observable<any> {
        const method = 'SalesforceApiService.getAccountDetails';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v65.0/sobjects/Account/${accountId}`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Creates a Quote with Quote Lines using the Salesforce Composite Graph API
     */
    createQuote(opportunityId: string, pricebookId: string, items: any[]): Observable<any> {
        const method = 'SalesforceApiService.createQuote';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v65.0/connect/rev/sales-transaction/actions/place`;

        // 1. Check if all items already have pricebookEntryId
        const missingPBE = items.filter(item => !item.pricebookEntryId && !item.defaultPrice?.pricebookEntryId);
        let pbeObservable: Observable<any>;

        if (missingPBE.length === 0) {
            // All items have PBE ID, skip fetch
            console.log(`[API Info] ${method} All items have PricebookEntryId, skipping lookup.`);
            pbeObservable = of({ records: [] });
        } else {
            // Fetch PricebookEntries for missing items
            const productIds = missingPBE.map(item => item.id);
            pbeObservable = this.getPricebookEntries(productIds);
        }

        return pbeObservable.pipe(
            switchMap((pbeResponse: any) => {
                const pbeRecords = pbeResponse.records || [];
                // Use the Pricebook2Id from the first record if available, else fallback to passed pricebookId
                // If we skipped lookup, we assume the passed pricebookId is correct or we take it from items if needed?
                // The API needs Pricebook2Id on the Quote.
                // If items have pricebookEntryId, we might not have Pricebook2Id here easily unless we fetch.
                // However, user usually passes pricebookId. Let's rely on that or the one found.
                const dynamicPricebookId = pbeRecords.length > 0 ? pbeRecords[0].Pricebook2Id : pricebookId;

                const today = new Date();
                const startDateStr = today.toISOString().split('T')[0];
                const expDate = new Date(today);
                expDate.setDate(expDate.getDate() + 45); // Default to 45 days duration
                const expDateStr = expDate.toISOString().split('T')[0];

                // Construct the records for the Graph API
                const records: any[] = [
                    {
                        "referenceId": "refQuote",
                        "record": {
                            "attributes": {
                                "method": "POST",
                                "type": "Quote"
                            },
                            "Name": "DealManagement-" + today.getTime(),
                            "OpportunityId": opportunityId,


                            "Pricebook2Id": dynamicPricebookId,
                            "StartDate": startDateStr,
                            "ExpirationDate": expDateStr
                        }
                    }
                ];

                // Add dynamic quote lines
                items.forEach((item, index) => {
                    // Find matching PricebookEntry if we descended to fetch
                    const matchingPBE = pbeRecords.find((pbe: any) => pbe.Product2Id === item.id);
                    const finalPBEId = matchingPBE ? matchingPBE.Id : (item.pricebookEntryId || item.defaultPrice?.pricebookEntryId || '01uDz00000dqLY8IAM');

                    // Conditional Logic: Looker Bundle vs Others (or just use dynamic fields if present)
                    // The user wants dynamic fields for ALL relevant items (Platform/Users) in this bundle flow.
                    // We can check if item has 'billingFrequency' etc to decide?
                    // Or just map everything that is present.

                    const baseAttributes = {
                        "type": "QuoteLineItem",
                        "method": "POST"
                    };

                    const startStr = item.startDate || new Date().toISOString().split('T')[0];
                    const startObj = new Date(startStr);
                    const endObj = new Date(startObj);
                    endObj.setDate(endObj.getDate() + 45);
                    const endStr = endObj.toISOString().split('T')[0];

                    const baseRecord: any = {
                        "attributes": baseAttributes,
                        "QuoteId": "@{refQuote.id}",
                        "Product2Id": item.id,
                        "PricebookEntryId": finalPBEId,
                        "Quantity": item.quantity || 1,

                        "StartDate": item.startDate || startDateStr,
                        "EndDate": expDateStr,
                        "PeriodBoundary": "Anniversary"
                    };

                    // Merge dynamic fields from item
                    // User requested specific fields:
                    // StartDate (mapped), EndDate, BillingFrequency, PeriodBoundary, Billing_Frequency__c, Operation_Type__c, Term_Starts_On__c

                    let recordData: any = { ...baseRecord };

                    if (item.billingFrequency) {
                        recordData["BillingFrequency"] = item.billingFrequency;
                    }
                    if (item.periodBoundary) {
                        recordData["PeriodBoundary"] = item.periodBoundary;
                    }

                    // Custom Fields
                    if (item.billingFrequency) {
                        // Map standard BillingFrequency to custom Billing_Frequency__c if needed, or take direct custom prop
                        // User example: BillingFrequency: "Monthly", Billing_Frequency__c: "Annual in Advance Anniversary"
                        // This implies they might be different or mapped.
                        // For now, I will take item.customBillingFrequency if exists, else default to 'Annual' or item.billingFrequency
                        recordData["Billing_Frequency__c"] = item.customBillingFrequency || "Annual";
                    }
                    if (item.operationType) {
                        recordData["Operation_Type__c"] = item.operationType;
                    }
                    if (item.termStartsOn) {
                        recordData["Term_Starts_On__c"] = item.termStartsOn;
                    }

                    // Subscription Term
                    if (item.subscriptionTerm) {
                        recordData["SubscriptionTerm"] = item.subscriptionTerm;
                    }
                    if (item.subscriptionTermUnit) {
                        recordData["SubscriptionTermUnit"] = item.subscriptionTermUnit;
                    }


                    records.push({
                        "referenceId": `refQuoteLine${index}`,
                        "record": recordData
                    });
                });

                const body = {
                    "pricingPref": "Skip",
                    "catalogRatesPref": "Skip",
                    "configurationPref": {
                        "configurationMethod": "Skip",
                        "configurationOptions": {
                            "executeConfigurationRules": false,
                            "addDefaultConfiguration": false
                        }
                    },
                    "taxPref": "Skip",
                    "contextDetails": {},
                    "graph": {
                        "graphId": "createQuote",
                        "records": records
                    }
                };

                console.log(`[API Request] ${method}`, { url, body });

                const headers = new HttpHeaders({
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                });

                return this.http.post(url, body, { headers }).pipe(
                    tap(response => console.log(`[API Response] ${method}`, response)),
                    catchError(err => this.handleError(method, err))
                );
            })
        );
    }

    /**
     * Fetches Quote details from Salesforce REST API
     * @param quoteId The Salesforce Quote ID
     * @returns Observable of quote details
     */
    getQuoteDetails(quoteId: string): Observable<any> {
        const method = 'SalesforceApiService.getQuoteDetails';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v65.0/sobjects/Quote/${quoteId}`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Loads a configurator instance for a transaction
     */
    loadConfiguratorInstance(transactionId: string): Observable<any> {
        const method = 'SalesforceApiService.loadConfiguratorInstance';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v66.0/connect/cpq/configurator/actions/load-instance`;

        const body = {
            "configuratorOptions": {
                "addDefaultConfiguration": false,
                "executeConfigurationRules": false,
                "executePricing": false,
                "qualifyAllProductsInTransaction": false,
                "validateAmendRenewCancel": false,
                "validateProductCatalog": false
            },
            "transactionId": transactionId
        };

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Gets a configurator instance by context ID
     */
    getConfiguratorInstance(contextId: string): Observable<any> {
        const method = 'SalesforceApiService.getConfiguratorInstance';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v66.0/connect/cpq/configurator/actions/get-instance`;

        const body = { "contextId": contextId };

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Executes a composite graph request to the Place API
     */
    placeGraphRequest(payload: any): Observable<any> {
        const method = 'SalesforceApiService.placeGraphRequest';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        // Handle endpoint (no save parameter added to URL)
        let url = `${baseUrl}/services/data/v65.0/connect/rev/sales-transaction/actions/place`;
        const body = { ...payload };

        // Ensure 'save' is not in the body if it causes issues, but Reference uses it.
        // Reference code: if (body.save !== undefined) delete body.save; 
        // But then later adds it back? 
        // Let's stick to the Reference implementation which DELETES it for the first payload but ADDS it for the remaining periods?
        // Actually, Reference `placeGraphRequest` deletes `save`.
        // But `syncRemainingPeriods` adds `save: true`.
        // Let's copy Reference `placeGraphRequest` logic:
        if (body.save !== undefined) {
            delete body.save;
        }

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                console.error('❌ Place API Update Error:', err);
                const fullError = err.error || err;
                console.error('Full Error Response Body:', JSON.stringify(fullError, null, 2));

                if (fullError.errorResponse) {
                    console.error('Detailed Error Response:', JSON.stringify(fullError.errorResponse, null, 2));
                } else if (Array.isArray(fullError)) {
                    console.error('Salesforce Error Array:', JSON.stringify(fullError, null, 2));
                }
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Updates Quote Start and Expiry dates via Salesforce REST PATCH
     */
    patchQuoteDates(quoteId: string, startDate: string, expirationDate: string): Observable<any> {
        const method = 'SalesforceApiService.patchQuoteDates';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        // Use standard sobjects PATCH for simple updates vs Graph API
        const url = `${baseUrl}/services/data/v65.0/sobjects/Quote/${quoteId}`;

        const body = {
            StartDate: startDate,
            ExpirationDate: expirationDate
        };

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.patch(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Syncs a Quote to an Opportunity by updating the SyncedQuoteId field.
     * @param opportunityId The Salesforce Opportunity ID
     * @param quoteId The Salesforce Quote ID to sync
     * @returns Observable of the update result
     */
    syncQuoteToOpportunity(opportunityId: string, quoteId: string | null): Observable<any> {
        const method = 'SalesforceApiService.syncQuoteToOpportunity';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v60.0/sobjects/Opportunity/${opportunityId}`;

        const body = {
            SyncedQuoteId: quoteId
        };

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.patch(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches QuoteLineItems for a given Quote ID
     * @param quoteId The Salesforce Quote ID
     * @returns Observable containing recentItems with QuoteLineItem IDs
     */
    getQuoteLineItems(quoteId: string): Observable<any> {
        const method = 'SalesforceApiService.getQuoteLineItems';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        // Using v59.0 and specific query as requested by user
        const query = `SELECT Id, Product2Id, PricebookEntryId FROM QuoteLineItem WHERE QuoteId = '${quoteId}'`;
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v59.0/query/?q=${encodedQuery}`;

        console.log(`[API Request] ${method}`, { url, quoteId });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches Bundle QuoteLineItems for a given Quote ID
     * @param quoteId The Salesforce Quote ID
     * @returns Observable containing Bundle QuoteLineItems
     */
    getBundleQuoteLineItems(quoteId: string): Observable<any> {
        const method = 'SalesforceApiService.getBundleQuoteLineItems';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        // Exact query requested by the user for v60.0
        const query = `SELECT Id,Product2Id,Product2.Name,Product2.Type FROM QuoteLineItem WHERE QuoteId='${quoteId}' AND Product2.Type='Bundle'`;
        const url = `${baseUrl}/services/data/v60.0/query/?q=SELECT+Id,Product2Id,Product2.Name,Product2.Type+FROM+QuoteLineItem+WHERE+QuoteId='${quoteId}'+AND+Product2.Type='Bundle'`;

        console.log(`[API Request] ${method}`, { url, quoteId });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Creates Commitment Details records using composite tree API
     * @param records Array of commitment records to create
     * @returns Observable of the creation result
     */
    createQuoteLineCommitments(records: any[]): Observable<any> {
        const method = 'SalesforceApiService.createQuoteLineCommitments';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v65.0/composite/tree/Commitment_Details__c`;

        const body = {
            records: records
        };

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Updates Quote Start and Expiry dates + Commitment Totals via Salesforce Graph API
     */
    updateQuoteDates(
        quoteId: string,
        startDate: string,
        expirationDate: string,
        term: number,
        totalCommitmentValue: number,
        quoteLineItems?: Array<{ id: string, commitmentAmount: number }>
    ): Observable<any> {
        const method = 'SalesforceApiService.updateQuoteDates';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        // Use composite/sobjects API which is a PATCH
        const url = `${baseUrl}/services/data/v65.0/composite/sobjects`;

        const records: any[] = [
            {
                "attributes": {
                    "type": "Quote"
                },
                "id": quoteId,
                "StartDate": startDate,
                "ExpirationDate": expirationDate,
                "Total_Commitment_Value__c": Number(totalCommitmentValue),
                "Term__c": Number(term)
            }
        ];

        // Add QuoteLineItem records if provided
        if (quoteLineItems && quoteLineItems.length > 0) {
            quoteLineItems.forEach((lineItem) => {
                records.push({
                    "attributes": {
                        "type": "QuoteLineItem"
                    },
                    "id": lineItem.id,
                    "Commitment_Amount__c": String(lineItem.commitmentAmount),
                    "StartDate": startDate,
                    "EndDate": expirationDate
                });
            });
        }

        const body = {
            "allOrNone": true,
            "records": records
        };

        console.log(`[API Request Body] ${method}`, JSON.stringify(body, null, 2));

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        // Use HTTP PATCH as requested by the user
        return this.http.patch(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Submits a Salesforce Graph API transaction
     * @param payload The graph payload containing records to be processed
     * @returns Observable of the transaction result
     */
    placeSalesTransaction(payload: any): Observable<any> {
        const method = 'SalesforceApiService.placeSalesTransaction';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v65.0/connect/rev/sales-transaction/actions/place`;

        console.log(`[API Request] ${method}`, { url, payload });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        // The endpoint expects a specific structure for pricing/tax/etc.
        // If the payload already has the 'graph' property, we wrap it with defaults if needed.
        const body = payload.graph ? {
            "pricingPref": "Skip",
            "catalogRatesPref": "Skip",
            "configurationPref": {
                "configurationMethod": "Skip",
                "configurationOptions": {
                    "validateProductCatalog": true,
                    "validateAmendRenewCancel": true,
                    "executeConfigurationRules": true,
                    "addDefaultConfiguration": true
                }
            },
            "taxPref": "Skip",
            "contextDetails": {},
            ...payload
        } : payload;

        return this.http.post(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }


    /**
     * Fetches Contact details from Salesforce REST API
     * @param contactId The Salesforce Contact ID
     * @returns Observable of contact details
     */
    getContactDetails(contactId: string): Observable<any> {
        const method = 'SalesforceApiService.getContactDetails';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v65.0/sobjects/Contact/${contactId}`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches Pricebook Entries for given Product2Ids
     */
    getPricebookEntries(productIds: string[]): Observable<any> {
        const method = 'SalesforceApiService.getPricebookEntries';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const idsString = productIds.map(id => `'${id}'`).join(',');
        const query = `SELECT Id, Pricebook2Id, Pricebook2.Name, UnitPrice, IsActive, CurrencyIsoCode, Product2Id FROM PricebookEntry WHERE Product2Id IN (${idsString})`;
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v65.0/query/?q=${encodedQuery}`;

        console.log(`[API Request] ${method}`, { url, query });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Fetches the 5 most recently created opportunities for today
     */
    getOpportunities(): Observable<any> {
        const method = 'SalesforceApiService.getOpportunities';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        // Query to get opportunities created today only, limited to 5
        // Query for specific date 2026-01-28 onwards (widened to catch timezone spillover)
        // Updated to include Account Website and Primary Contact (via Roles) as requested
        const query = `SELECT Id, Name, StageName, Amount, CloseDate, Owner.Name, AccountId, Account.Name, Account.Website, CreatedDate, (SELECT Contact.Id, Contact.Name FROM OpportunityContactRoles WHERE IsPrimary = true) FROM Opportunity WHERE CreatedDate >= 2026-01-28T00:00:00Z ORDER BY CreatedDate DESC LIMIT 5`;
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v65.0/query?q=${encodedQuery}`;

        console.log(`[API Request] ${method}`, { url, query });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Fetches the 5 most recently updated products
     */
    getRecentProducts(): Observable<any> {
        const method = 'SalesforceApiService.getRecentProducts';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const query = `SELECT Id, Name, Family, LastModifiedDate FROM Product2 ORDER BY LastModifiedDate DESC LIMIT 5`;
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v65.0/query?q=${encodedQuery}`;

        console.log(`[API Request] ${method}`, { url, query });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Fetches detailed opportunity data using SOQL query
     */
    getOpportunitiesDetails(ids: string[]): Observable<any> {
        const method = 'SalesforceApiService.getOpportunitiesDetails';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        // Build the WHERE clause with multiple IDs
        const idsString = ids.map(id => `'${id}'`).join(',');
        const query = `SELECT Id, Name, Amount, CloseDate, AccountId, Account.Name, Account.Website, Owner.Name, Pricebook2Id, Primary_Contact__c, Sales_Channel__c, (SELECT Contact.Name FROM OpportunityContactRoles WHERE IsPrimary = true) FROM Opportunity WHERE Id IN (${idsString})`;
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v65.0/query/?q=${encodedQuery}`;

        console.log(`[API Request] ${method}`, { url, query });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Fetches comprehensive quote preview data using SOQL query
     */
    getQuotePreview(quoteId: string): Observable<any> {
        const method = 'SalesforceApiService.getQuotePreview';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const quoteQuery = `SELECT Id, Name, QuoteNumber, Status, GrandTotal, StartDate, ExpirationDate, Pricebook2Id, Opportunity.Name, Opportunity.Sales_Channel__c, Opportunity.Primary_Contact__c, Opportunity.Primary_Contact__r.Name, Account.Name, Account.Website FROM Quote WHERE Id='${quoteId}'`;
        const lineItemQuery = `SELECT Id, QuoteId, Product2Id, PricebookEntryId, Product2.Name, Product2.ProductCode, Product2.Family, Product2.Type, Product2.Description, Quantity, UnitPrice, TotalPrice, ListPrice, StartDate, EndDate, Discount, Incentive__c, NetUnitPrice, SortOrder FROM QuoteLineItem WHERE QuoteId = '${quoteId}' ORDER BY SortOrder ASC, CreatedDate ASC LIMIT 2000`;

        const encodedQuoteQuery = encodeURIComponent(quoteQuery);
        const encodedLineItemQuery = encodeURIComponent(lineItemQuery);

        const quoteUrl = `${baseUrl}/services/data/v66.0/query/?q=${encodedQuoteQuery}`;
        const lineItemUrl = `${baseUrl}/services/data/v66.0/query/?q=${encodedLineItemQuery}`;

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return forkJoin({
            quote: this.http.get(quoteUrl, { headers }),
            lines: this.http.get(lineItemUrl, { headers })
        }).pipe(
            map((res: any) => {
                if (res.quote.records && res.quote.records.length > 0) {
                    const quote = res.quote.records[0];
                    quote.QuoteLineItems = res.lines;
                    return { records: [quote] };
                }
                return { records: [] };
            }),
            tap(response => console.log(`[API Response combined] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }



    /**
     * Generic method to fetch picklist values using UI API
     */
    getAllPicklistValues(objectApiName: string, recordTypeId: string): Observable<any> {
        const method = `SalesforceApiService.getAllPicklistValues`;
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl;

        const url = `${baseUrl}/services/data/v65.0/ui-api/object-info/${objectApiName}/picklist-values/${recordTypeId}`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Searches for products using the Connect CPQ Search API
     */
    searchProducts(searchTerm: string, categoryId: string | null, criteria: any[] = [], cursor: string | null = null, limit: number = 100): Observable<any> {
        const method = 'SalesforceApiService.searchProducts';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v66.0/connect/cpq/products/search`;

        const body: any = {
            "filter": {
                "criteria": criteria && criteria.length > 0 ? criteria : [
                    {
                        "property": "isActive",
                        "operator": "eq",
                        "value": true
                    }
                ]
            },
            "additionalFields": {
                "Product2": {
                    "fields": ["RCA_Sort_order__c", "RCA_Product_Count__c"]
                }
            },
            "limit": limit,
            "searchTerm": searchTerm
        };

        if (categoryId) {
            body.categoryId = categoryId;
        }

        // Add cursor only if a valid token exists (Omit if null or empty string per requirement)
        if (cursor && cursor.trim() !== "") {
            body.cursor = cursor;
        }

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => {
                // Enhance error logging for cursor issues
                console.error(`[CRITICAL] cursor: "${cursor}" failed in ${method}`, err);
                return this.handleError(method, err);
            })
        );
    }

    /**
     * Searches for product groups (bundles) using the Connect CPQ Search API
     */
    searchProductGroups(searchTerm: string, categoryId: string | null): Observable<any> {
        const method = 'SalesforceApiService.searchProductGroups';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v66.0/connect/cpq/products/search`;

        const body: any = {
            "filter": {
                "criteria": [
                    {
                        "property": "isActive",
                        "operator": "eq",
                        "value": true
                    },
                    {
                        "property": "Type",
                        "operator": "eq",
                        "value": "bundle"
                    }
                ]
            },
            "additionalFields": {
                "Product2": {
                    "fields": ["RCA_Sort_order__c", "RCA_Product_Count__c"]
                }
            },
            "limit": 600,
            "productClassificationId": "11BDz00000000NvMAI",
            "searchTerm": searchTerm
        };

        if (categoryId) {
            body.categoryId = categoryId;
        }

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches Bundle Details (Product Component Groups)
     */
    getBundleDetails(bundleId: string): Observable<any> {
        const method = 'SalesforceApiService.getBundleDetails';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v65.0/connect/cpq/products/${bundleId}`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, {}, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches Product Relationship Type ID
     */
    getProductRelationshipType(): Observable<any> {
        const method = 'SalesforceApiService.getProductRelationshipType';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const query = `SELECT Id, Name FROM ProductRelationshipType WHERE Name = 'Bundle to Bundle Component Relationship' LIMIT 1`;
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v65.0/query/?q=${encodedQuery}`;

        console.log(`[API Request] ${method}`, { url, query });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches picklist values for Product2 fields
     * @returns Observable of picklist values response
     */
    getProductPicklistValues(): Observable<any> {
        const method = 'SalesforceApiService.getProductPicklistValues';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const url = `${baseUrl}/services/data/v65.0/ui-api/object-info/Product2/picklist-values/012000000000000AAA/`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Performs a global search for products using the Salesforce PCM Connect API
     * @param categoryIds Array of Category IDs to filter by
     * @param searchTerm The search string
     * @param pageSize Number of results per page
     * @param offset Result offset for pagination
     */
    globalSearchProducts(categoryIds: string[], searchTerm: string, pageSize: number = 100, offset: number = 0): Observable<any> {
        const method = 'SalesforceApiService.globalSearchProducts';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const url = `${baseUrl}/services/data/v65.0/connect/pcm/products?include=/products`;

        const body = {
            categoryIds: categoryIds,
            searchTerm: searchTerm,
            pageSize: pageSize,
            offset: offset
        };

        console.log(`[API Request] ${method}`, { url, body });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.post(url, body, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches Contacts for a given Account ID
     */
    getContactsByAccount(accountId: string): Observable<any> {
        const method = 'SalesforceApiService.getContactsByAccount';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const query = `SELECT Id, Name, Email FROM Contact WHERE AccountId = '${accountId}' ORDER BY Name ASC LIMIT 100`;
        const encodedQuery = encodeURIComponent(query);
        const url = `${baseUrl}/services/data/v65.0/query/?q=${encodedQuery}`;

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    /**
     * Fetches picklist values for Quote fields
     */
    getQuotePicklistValues(recordTypeId: string = '012000000000000AAA'): Observable<any> {
        const method = 'SalesforceApiService.getQuotePicklistValues';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl;

        const url = `${baseUrl}/services/data/v65.0/ui-api/object-info/Quote/picklist-values/${recordTypeId}/`;

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    getActiveQuotesCount(oppId: string): Observable<any> {
        const method = 'SalesforceApiService.getActiveQuotesCount';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const url = `${baseUrl}/services/data/v60.0/query/?q=SELECT COUNT() FROM Quote WHERE OpportunityId = '${oppId}'`;


        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    getActiveQuotes(oppId: string, srt: string, pageSize: number = 100, offset: number = 0): Observable<any> {
        const method = 'SalesforceApiService.getActiveQuotes';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const url = `${baseUrl}/services/data/v60.0/query/?q=SELECT Id, Name, QuoteNumber, Status, IsSyncing, GrandTotal, Account.Name, Contact.Name, Contact.Email, Quote.CreatedBy.Name, 
                Quote.Account.briefingedge__Primary_Contact__c, ExpirationDate, CreatedDate FROM Quote WHERE OpportunityId = '${oppId}' ORDER BY QuoteNumber ${srt} LIMIT ${pageSize} OFFSET ${offset}`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    quotesSearch(oppId: string, searchTerm: string, srt: string, pageSize: number, offset: number): Observable<any> {
        const method = 'SalesforceApiService.quotesSearch';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const url = `${baseUrl}/services/data/v66.0/search?q=FIND {${searchTerm}*} IN ALL FIELDS RETURNING Quote(Id, QuoteNumber, Name, Status, TotalPrice, Account.Name, 
                Quote.Account.briefingedge__Primary_Contact__c, ExpirationDate, CreatedBy.Name WHERE OpportunityId = '${oppId}' ORDER BY QuoteNumber ${srt} LIMIT ${pageSize} OFFSET ${offset})`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }

    getQuoteProducts(quoteId: string) {
        const method = 'SalesforceApiService.getQuoteProducts';
        const token = this.contextService.accessToken;
        const baseUrl = this.contextService.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';

        const url = `${baseUrl}/services/data/v60.0/query/?q=SELECT MIN(Id) quoteLineItemId, Product2Id,Product2.Name, Product2.Parent_Bundle_Product__c FROM QuoteLineItem WHERE QuoteId='${quoteId}' AND Product2.Parent_Bundle_Product__c=true GROUP BY Product2Id, Product2.Name,Product2.Parent_Bundle_Product__c`;

        console.log(`[API Request] ${method}`, { url });

        const headers = new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });

        return this.http.get(url, { headers }).pipe(
            tap(response => console.log(`[API Response] ${method}`, response)),
            catchError(err => this.handleError(method, err))
        );
    }
}
