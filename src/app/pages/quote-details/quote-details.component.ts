import { Component, HostListener, OnInit, inject, ViewChild } from '@angular/core';
import { DiscountsIncentivesComponent } from '../../components/discounts-incentives/discounts-incentives.component';
import { DiscountIncentiveStateService } from '../../services/discount-incentive-state.service';
import { CommonModule } from '@angular/common';
import { QuoteRefreshService } from '../../services/quote-refresh.service';
import { CartService } from '../../services/cart.service';
import { ContextService } from '../../services/context.service';
import { SalesforceApiService } from '../../services/salesforce-api.service';
import { QuoteDataService } from '../../services/quote-data.service';
import { switchMap, map } from 'rxjs/operators';
import { Observable, of, forkJoin } from 'rxjs';
import { Router } from '@angular/router';
import { LoadingService } from '../../services/loading.service';
import { ToastService } from '../../services/toast.service';
import html2canvas from 'html2canvas';

import { FormsModule } from '@angular/forms';
import { SubscriptionPeriodsModalComponent } from '../../components/subscription-periods-modal/subscription-periods-modal';
import { SubscriptionPeriodItemComponent, SubscriptionPeriod, ProductItem } from '../../components/subscription-period-item/subscription-period-item';

@Component({
    selector: 'app-quote-details',
    standalone: true,
    imports: [CommonModule, FormsModule, DiscountsIncentivesComponent, SubscriptionPeriodsModalComponent, SubscriptionPeriodItemComponent],
    templateUrl: './quote-details.component.html',
    styles: [`
        .slim-scrollbar::-webkit-scrollbar {
            width: 4px;
        }
        .slim-scrollbar::-webkit-scrollbar-track {
            background: #f1f5f9;
            border-radius: 4px;
        }
        .slim-scrollbar::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 4px;
        }
        .slim-scrollbar::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
        }
    `]
})
export class QuoteDetailsComponent implements OnInit {
    @ViewChild(DiscountsIncentivesComponent) discountsIncentives?: DiscountsIncentivesComponent;
    public matchedPreviewItemIds = new Set<string>();
    public lastSavedCommitmentState: string | null = null;
    public lastSavedLookerState: string | null = null;
    static lastInitTime = 0;
    private router = inject(Router);
    private sfApi = inject(SalesforceApiService);
    private contextService = inject(ContextService);
    private cartService = inject(CartService);
    private loadingService = inject(LoadingService);
    private quoteDataService = inject(QuoteDataService);
    private toastService = inject(ToastService);
    private quoteRefreshService = inject(QuoteRefreshService);
    private discountIncentiveStateService = inject(DiscountIncentiveStateService);

    isSaving: boolean = false;
    isLoading: boolean = true; // Start in loading state
    showSuccessPopup: boolean = false;
    showPreviewPopup: boolean = false;
    previewData: any = null;
    previewScreenshot: string | null = null;
    isCapturingScreenshot: boolean = false; // Flag to hide preview during screenshot capture

    commitmentPeriods: any[] = [{ months: null, amount: null, isCollapsed: false }];
    activeMenuIndex: number | null = null;
    activeTab: 'details' | 'discounts' = 'details';

    // Quote Data Properties
    opportunityName: string = '';
    accountName: string = '';
    quoteId: string = '';
    primaryContactName: string = '';
    salesChannel: string = '';
    productName: string = 'No Products';
    productId: string | null = null;
    bundleQuoteLineId: string | null = null;
    bundlePricebookEntryId: string | null = null;
    website: string | null = null;
    pricebookId: string | null = null;
    categoryId: string | null = null;
    isGCP: boolean = false;

    // Dates
    startDate: string = new Date().toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD format logically
    expirationDate: string = ''; // Initially empty
    previewCommitments: any[] = [];
    previewProductsWithoutDiscounts: any[] = []; // Products without discounts or incentives
    todayDate: Date = new Date(); // Keep for explicit today reference if needed
    minDate: string = new Date().toLocaleDateString('en-CA');

    // Term Start Date (Separate from Quote Start Date)
    termStartInput: string = '';
    private lastValidTermStart: string = '';
    private lastValidTermEnd: string = '';

    get termStartDate(): string { return this.termStartInput; }
    set termStartDate(val: string) { this.termStartInput = val; }

    // Subscription Flow (Looker New RCA) Properties
    operationType: string = 'New';
    billingFrequency: string = 'Annual in Advance';
    termStartsOn: string = 'Fixed Start Date';

    termEndDate: string = '';

    operationTypeOptions = [];
    billingFrequencyOptions = [];
    termStartsOnOptions = [];

    // Subscription State
    isSubscriptionModalOpen: boolean = false;
    currentFrequency: string = 'Yearly';
    subscriptionPeriods: SubscriptionPeriod[] = [];
    productOptions: ProductItem[] = [];
    lookerRegionOptions: string[] = [];

    developerUserPrice: number = 100;
    standardUserPrice: number = 200;
    viewerUserPrice: number = 50;

    // User Product IDs and Metadata
    private developerUserProductId: string = '';
    private developerUserPBEId: string = '';
    private developerUserName: string = '';
    private standardUserProductId: string = '';
    private standardUserPBEId: string = '';
    private standardUserName: string = '';
    private viewerUserProductId: string = '';
    private viewerUserPBEId: string = '';
    private viewerUserName: string = '';

    // UI State for Subscription Dropdowns
    operationTypeOpen = false;
    billingFrequencyOpen = false;
    termStartsOnOpen = false;
    primaryContactOpen = false;
    salesChannelOpen = false;

    // Dropdown Options
    primaryContactOptions: string[] = ['Alex Morgan', 'Yin Jye Lee', 'Sarah Connor', 'John Doe'];
    salesChannelOptions: string[] = ['Reseller', 'Partner', 'Direct'];

    // API Data for Save Logic
    existingQuoteLineItems: any[] = [];
    productRelationshipTypeId: string = '';
    private lookerDataInitialized: boolean = false;


    private initializeLookerDataIfNeeded() {
        if (this.isLookerSubscription && !this.lookerDataInitialized) {
            console.log('🔍 Looker Subscription detected. Initializing picklists.');
            this.lookerDataInitialized = true;
            // Removed: this.loadBundleDetails(); - Deferring until subscription periods are created via modal
            this.loadAllPicklists();
            this.checkAndDefaultExpirationDate();
        }
    }


    switchTab(tab: 'details' | 'discounts') {
        if (tab === 'discounts') {
            if (this.isLookerSubscription) {
                if (!this.termStartInput || !this.termEndDate) {
                    this.toastService.show('Please provide Term Start Date and End Date before proceeding.', 'warning');
                    return;
                }
            } else {
                const hasValidPeriod = this.commitmentPeriods.some(p => p.months && p.amount);
                if (!hasValidPeriod) {
                    this.toastService.show('Please provide at least one valid commitment period (Months and Amount) before proceeding.', 'warning');
                    return;
                }
            }
        }

        this.activeTab = tab;
    }

    updateBaselineStates() {
        this.lastSavedCommitmentState = JSON.stringify({
            commitments: this.commitmentPeriods,
            startDate: this.startDate,
            expirationDate: this.expirationDate
        });

        this.lastSavedLookerState = JSON.stringify({
            periods: this.subscriptionPeriods,
            startDate: this.startDate,
            expirationDate: this.expirationDate,
            termStartInput: this.termStartInput,
            termEndDate: this.termEndDate
        });
    }

    loadBundleDetails() {
        let bundleId = this.productId;
        if (!bundleId && this.isLookerSubscription) {
            bundleId = '01tDz00000Ea17zIAB'; // Default Looker Bundle ID
        }
        if (!bundleId) {
            console.warn('⚠️ Cannot load bundle details: productId is missing.');
            return;
        }
        this.loadingService.show();

        this.sfApi.getBundleDetails(bundleId).subscribe({
            next: (data) => {
                console.log('📦 Bundle Details Received:', data);
                // Handle response structure (Connect API sometimes wraps in 'result' or returns directly)
                const result = data.result || data;

                if (result && result.productComponentGroups) {
                    const groups = result.productComponentGroups;

                    // Extract bundle's own monthly PricebookEntryId
                    if (result.prices && result.prices.length > 0) {
                        const monthlyPrice = result.prices.find((p: any) => p.pricingModel?.frequency === 'Months');
                        if (monthlyPrice) {
                            this.bundlePricebookEntryId = monthlyPrice.priceBookEntryId;
                            console.log('💎 Captured Bundle Monthly PBE:', this.bundlePricebookEntryId);
                        } else {
                            // Fallback to the first available price if monthly is not found
                            this.bundlePricebookEntryId = result.prices[0].priceBookEntryId;
                            console.log('💎 Fallback Bundle PBE captured:', this.bundlePricebookEntryId);
                        }
                    }


                    const platformGroup = groups.find((g: any) => g.name === 'Platform');
                    const nonProdGroup = groups.find((g: any) => g.name === 'Non-production' || g.name === 'Non-Production');

                    if (platformGroup) {
                        this.productOptions = platformGroup.components.map((c: any) => {
                            const priceObj = c.prices ? c.prices.find((p: any) => p.pricingModel?.frequency === 'Months') : null;
                            const mainPrice = priceObj ? priceObj.price : 0;
                            const frequency = priceObj && priceObj.pricingModel ? priceObj.pricingModel.frequency : 'Months';
                            const pricebookEntryId = priceObj ? priceObj.priceBookEntryId : null;


                            let nonProdPrice = 0;
                            let nonProdProductId = null;
                            let nonProdPricebookEntryId = null;
                            let nonProdProductName = null;
                            if (nonProdGroup) {
                                const name = c.name.toLowerCase();
                                const match = nonProdGroup.components.find((npc: any) => {
                                    const npcName = npc.name.toLowerCase();
                                    if (name.includes('standard') && npcName.includes('standard')) return true;
                                    if (name.includes('enterprise') && npcName.includes('enterprise')) return true;
                                    if (name.includes('embed') && npcName.includes('embed')) return true;
                                    return false;
                                });
                                if (match) {
                                    const npPriceObj = match.prices ? match.prices.find((p: any) => p.pricingModel?.frequency === 'Months') : null;
                                    nonProdPrice = npPriceObj ? npPriceObj.price : 0;
                                    nonProdProductId = match.id;
                                    nonProdPricebookEntryId = npPriceObj ? npPriceObj.priceBookEntryId : null;
                                    nonProdProductName = match.name;
                                }
                            }

                            return {
                                category: 'Platform',
                                name: c.name,
                                price: mainPrice,
                                nonProdPrice: nonProdPrice,
                                frequency: frequency,
                                productId: c.id,
                                pricebookEntryId: pricebookEntryId,
                                nonProdProductId: nonProdProductId,
                                nonProdPricebookEntryId: nonProdPricebookEntryId,
                                nonProdProductName: nonProdProductName,
                                startDate: null,
                                endDate: null,
                                billingFrequency: 'Annual',
                                periodBoundary: 'Anniversary',
                                operationType: 'New',
                                termStartsOn: 'Fixed Start Date',
                                subscriptionTermUnit: 'Months'
                            };
                        });
                    }


                    const userGroup = groups.find((g: any) => g.name === 'Users');
                    if (userGroup) {
                        userGroup.components.forEach((c: any) => {
                            const priceObj = c.prices ? c.prices.find((p: any) => p.pricingModel?.frequency === 'Months') : null;
                            const price = priceObj ? priceObj.price : 0;
                            const productId = c.productId || c.product2Id || c.id;
                            const pricebookEntryId = priceObj ? priceObj.priceBookEntryId : null;

                            // Update class metadata for future periods
                            if (c.name.includes('Developer')) {
                                this.developerUserPrice = price;
                                this.developerUserProductId = productId;
                                this.developerUserPBEId = pricebookEntryId;
                                this.developerUserName = c.name;
                            } else if (c.name.includes('Standard')) {
                                this.standardUserPrice = price;
                                this.standardUserProductId = productId;
                                this.standardUserPBEId = pricebookEntryId;
                                this.standardUserName = c.name;
                            } else if (c.name.includes('Viewer')) {
                                this.viewerUserPrice = price;
                                this.viewerUserProductId = productId;
                                this.viewerUserPBEId = pricebookEntryId;
                                this.viewerUserName = c.name;
                            }
                        });

                        // Sync any existing periods (including the one just created)
                        this.syncAllPeriodUserProducts();
                    }


                    this.loadingService.hide();

                } else {
                    console.warn('⚠️ No productComponentGroups found in response.');
                    this.loadingService.hide();
                }
            },
            error: (err) => {
                console.error('❌ Failed to load bundle details:', err);
                this.loadingService.hide();
                this.toastService.show('Failed to load products.', 'error');
            }
        });
    }

    openSubscriptionModal() {
        const termYears = this.getTermYears();
        if (this.subscriptionPeriods.length >= termYears && termYears > 0) {
            alert('You must change the term end date to create new period');
            return;
        }
        this.isSubscriptionModalOpen = true;
    }

    addSubscriptionPeriodDirectly() {
        if (this.subscriptionPeriods.length === 0) {
            if (this.termStartInput && this.termEndDate) {
                // For first period, we still want to default to something, 
                // but if Custom, maybe we should also leave it empty?
                // The prompt says "periods which are created with add period button... don't set any values"
                if (this.currentFrequency === 'Custom') {
                    this.addOnePeriod('', '');
                } else {
                    this.addOnePeriod(this.termStartInput, this.termEndDate);
                }
                this.onSubscriptionProductChanged();
            } else {
                this.isSubscriptionModalOpen = true;
            }
            return;
        }

        const lastPeriod = this.subscriptionPeriods[this.subscriptionPeriods.length - 1];

        // Only allow adding if the previous one is filled
        if (!lastPeriod.startDate || !lastPeriod.endDate) {
            this.toastService.show('Please fill the current period dates before adding a new one.', 'warning');
            return;
        }

        if (this.currentFrequency === 'Custom') {
            this.addOnePeriod('', '');
            // We don't call onSubscriptionProductChanged here yet as it's empty
            return;
        }

        const prevEnd = this.parseDate(lastPeriod.endDate);
        const nextStart = new Date(prevEnd);
        nextStart.setDate(nextStart.getDate() + 1);

        // Default to 1 year
        const nextEnd = new Date(nextStart);
        nextEnd.setFullYear(nextEnd.getFullYear() + 1);
        nextEnd.setDate(nextEnd.getDate() - 1);

        const nextStartIso = this.toIsoDateString(nextStart);
        const nextEndIso = this.toIsoDateString(nextEnd);

        if (this.currentFrequency === 'Yearly') {
            // Automatically update subscription end date to accommodate the new 1-year period
            this.termEndDate = nextEndIso;
        }

        const totalEnd = this.termEndDate ? this.parseDate(this.termEndDate) : null;
        let finalEnd = nextEnd;
        if (this.currentFrequency !== 'Yearly' && totalEnd && nextEnd > totalEnd) {
            finalEnd = totalEnd;
        }

        this.addOnePeriod(nextStartIso, this.toIsoDateString(finalEnd));
        this.onSubscriptionProductChanged();
    }

    removeSubscriptionPeriod(index: number) {
        if (this.subscriptionPeriods.length > 0) {
            this.subscriptionPeriods.splice(index, 1);
            this.onSubscriptionProductChanged();
        }
    }

    closeSubscriptionModal() {
        this.isSubscriptionModalOpen = false;
    }

    onSubscriptionPeriodsCreated(frequency: string) {
        this.currentFrequency = frequency;
        this.loadBundleDetails(); // Trigger immediately on Create click

        const effectiveStart = (this.isLookerSubscription && this.termStartInput) ? this.termStartInput : this.startDate;

        if (!effectiveStart || !this.termEndDate) {
            this.toastService.show('Please select both Subscription Start Date and End Date.', 'error');
            this.closeSubscriptionModal();
            return;
        }

        const totalStart = this.parseDate(effectiveStart);
        const totalEnd = this.termEndDate ? this.parseDate(this.termEndDate) : new Date(totalStart.getFullYear() + 1, totalStart.getMonth(), totalStart.getDate() - 1);

        if (totalStart > totalEnd) {
            this.addOnePeriod(effectiveStart, this.termEndDate || this.toIsoDateString(totalEnd));
            this.closeSubscriptionModal();
            return;
        }

        if (this.currentFrequency === 'Yearly' && !this.isValidYearlyDuration(effectiveStart, this.termEndDate)) {
            this.toastService.show('Subscription duration should be exactly in years for yearly periods', 'error');
            this.closeSubscriptionModal();
            return;
        }

        // Capture valid state for future reversions
        this.lastValidTermStart = this.termStartInput;
        this.lastValidTermEnd = this.termEndDate;

        this.subscriptionPeriods = [];
        let currentStart = new Date(totalStart);
        let pIndex = 1;

        while (currentStart <= totalEnd) {
            let nextStart = new Date(currentStart);
            nextStart.setFullYear(nextStart.getFullYear() + 1);

            let periodEnd = new Date(nextStart);
            periodEnd.setDate(periodEnd.getDate() - 1);

            if (periodEnd > totalEnd) {
                periodEnd = new Date(totalEnd);
            }

            this.addPeriodItem(pIndex++, currentStart, periodEnd, false);

            currentStart = nextStart;
            if (currentStart > totalEnd) break;
            if (pIndex > 50) break; // Safety
        }

        // Ensure all periods have durationDays set
        this.subscriptionPeriods.forEach(p => {
            if (!p.durationDays && p.startDate && p.endDate) {
                const s = this.parseDate(p.startDate);
                const e = this.parseDate(p.endDate);
                const diffTime = Math.abs(e.getTime() - s.getTime());
                p.durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
            }
        });

        const sfQuoteId = this.salesforceQuoteId;
        if (sfQuoteId) {
            console.log('🔄 Fetching Quote Line Items and Relationship Types...', { sfQuoteId });

            const relType$ = this.productRelationshipTypeId
                ? of({ records: [{ Id: this.productRelationshipTypeId, Name: 'Bundle to Bundle Component Relationship' }] })
                : this.sfApi.getProductRelationshipType();

            const needRefresh = this.quoteRefreshService.consumeRefreshFlag();
            if (!needRefresh) {
                console.log('⚡ Skipping getQuoteLineItems call as no changes detected.');
                relType$.subscribe({
                    next: (prRes: any) => {
                        this.extractRelationshipId(prRes);
                        this.closeSubscriptionModal();
                    },
                    error: (err) => {
                        console.error('❌ Error resolving product relationship type:', err);
                        this.closeSubscriptionModal();
                    }
                });
                return;
            }

            forkJoin({
                qlItems: this.sfApi.getQuoteLineItems(sfQuoteId),
                prType: relType$
            }).subscribe({
                next: (results: any) => {
                    console.log('✅ APIs Fetched Successfully on Create:', results);

                    if (results.qlItems && results.qlItems.records) {
                        this.existingQuoteLineItems = results.qlItems.records;
                    }

                    this.extractRelationshipId(results.prType);
                    this.closeSubscriptionModal();
                },
                error: (err) => {
                    console.error('❌ Error fetching dynamic APIs on create:', err);
                    this.closeSubscriptionModal();
                }
            });
        } else {
            this.closeSubscriptionModal();
        }
    }

    private extractRelationshipId(response: any) {
        if (!response) return;
        const relTypes = response.records || response.recentItems || [];
        const bundleRelType = relTypes.find((r: any) => r.Name === 'Bundle to Bundle Component Relationship');

        if (bundleRelType) {
            this.productRelationshipTypeId = bundleRelType.Id;
            console.log('🔗 Resolved Relationship Type ID:', this.productRelationshipTypeId);
        } else if (relTypes.length > 0) {
            this.productRelationshipTypeId = relTypes[0].Id;
        }
    }


    addOnePeriod(start: string, end: string) {
        const startDate = start ? this.parseDate(start) : null;
        const endDate = end ? this.parseDate(end) : null;
        this.addPeriodItem(this.subscriptionPeriods.length + 1, startDate, endDate, true);
    }

    addPeriodItem(index: number, start: Date | null, end: Date | null, isManual: boolean = true) {
        const startDateIso = start ? this.toIsoDateString(start) : '';
        const endDateIso = end ? this.toIsoDateString(end) : '';

        let durationDays = 0;
        if (start && end) {
            const diffTime = Math.abs(end.getTime() - start.getTime());
            durationDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        }

        this.subscriptionPeriods.push({
            id: Math.random().toString(36).substr(2, 9),
            name: `Period ${index}`,
            productCategory: 'Platform',
            productName: '',
            startDate: startDateIso,
            endDate: endDateIso,
            discount: null,
            unitPrice: null,
            nonProdPrice: null,
            isExpanded: true,
            userRows: this.getDefaultUserRows(),
            durationDays: durationDays,
            isManual: isManual
        });
    }

    private getDefaultUserRows() {
        return [
            { type: 'Viewer', price: this.viewerUserPrice, frequency: 'Months', quantity: null, region: '', gcpProjectId: '', lookerInstanceId: '', discount: null, productId: this.viewerUserProductId, pricebookEntryId: this.viewerUserPBEId, name: this.viewerUserName },
            { type: 'Standard', price: this.standardUserPrice, frequency: 'Months', quantity: null, region: '', gcpProjectId: '', lookerInstanceId: '', discount: null, productId: this.standardUserProductId, pricebookEntryId: this.standardUserPBEId, name: this.standardUserName },
            { type: 'Developer', price: this.developerUserPrice, frequency: 'Months', quantity: null, region: '', gcpProjectId: '', lookerInstanceId: '', discount: null, productId: this.developerUserProductId, pricebookEntryId: this.developerUserPBEId, name: this.developerUserName },
            { type: 'Non-prod', price: 0, frequency: 'Months', quantity: null, region: '', gcpProjectId: '', lookerInstanceId: '', discount: null }
        ];
    }

    private getTermYears(): number {
        const startToUse = (this.isLookerSubscription && this.termStartInput) ? this.termStartInput : this.startDate;
        if (!startToUse || !this.termEndDate) return 0;
        try {
            const start = this.parseDate(startToUse);
            const end = this.parseDate(this.termEndDate);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
            let months = (end.getFullYear() - start.getFullYear()) * 12;
            months += end.getMonth() - start.getMonth();
            if (end.getDate() < start.getDate()) months--;
            return Math.ceil((months + 1) / 12);
        } catch (e) { return 0; }
    }

    private parseDate(dateStr: string): Date {
        if (!dateStr) return new Date(NaN); // Return invalid date for empty string
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        // Check for invalid date components (e.g., 2023-02-30)
        if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
            return new Date(NaN);
        }
        return date;
    }

    private isValidYearlyDuration(startDate: string, endDate: string): boolean {
        if (!startDate || !endDate) return false;
        const start = this.parseDate(startDate);
        const end = this.parseDate(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;

        const checkDate = new Date(start);
        while (checkDate <= end) {
            checkDate.setFullYear(checkDate.getFullYear() + 1);
            const expectedEnd = new Date(checkDate);
            expectedEnd.setDate(expectedEnd.getDate() - 1);
            if (expectedEnd.getTime() === end.getTime()) return true;
            if (expectedEnd > end) break;
        }
        return false;
    }

    private toIsoDateString(date: Date): string {
        if (!date || isNaN(date.getTime())) return '';
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    calculateSubscriptionTerm(startDate: string, endDate: string): number {
        if (!startDate || !endDate) return 1;
        const start = this.parseDate(startDate);
        const end = this.parseDate(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 1;

        const endAdjusted = new Date(end);
        endAdjusted.setDate(endAdjusted.getDate() + 1);

        let months = (endAdjusted.getFullYear() - start.getFullYear()) * 12 + (endAdjusted.getMonth() - start.getMonth());
        const temp = new Date(start);
        temp.setMonth(temp.getMonth() + months);

        if (temp > endAdjusted) {
            months--;
            temp.setTime(start.getTime());
            temp.setMonth(temp.getMonth() + months);
        }

        const diffTime = endAdjusted.getTime() - temp.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return months;

        const daysInMonth = new Date(temp.getFullYear(), temp.getMonth() + 1, 0).getDate();
        return (months + (diffDays / daysInMonth));
    }
    formatTermDisplay(startDate: string, endDate: string): string {
        if (!startDate || !endDate) return '';
        const start = this.parseDate(startDate);
        const end = this.parseDate(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';

        const endAdjusted = new Date(end);
        endAdjusted.setDate(endAdjusted.getDate() + 1);

        let months = (endAdjusted.getFullYear() - start.getFullYear()) * 12 + (endAdjusted.getMonth() - start.getMonth());
        const temp = new Date(start);
        temp.setMonth(temp.getMonth() + months);

        if (temp > endAdjusted) {
            months--;
            temp.setTime(start.getTime());
            temp.setMonth(temp.getMonth() + months);
        }

        const diffTime = endAdjusted.getTime() - temp.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        let res = '';
        if (months > 0) res += `${months} month${months > 1 ? 's' : ''} `;
        if (diffDays > 0) res += `${diffDays} day${diffDays > 1 ? 's' : ''}`;
        return res.trim() || '0 months';
    }

    onSubscriptionProductChanged() {
        console.log('🔄 Subscription period changed, refreshing term and totals...');

        if (!this.subscriptionPeriods || this.subscriptionPeriods.length === 0) {
            if (this.termStartInput && this.termEndDate) {
                this.lastValidTermStart = this.termStartInput;
                this.lastValidTermEnd = this.termEndDate;
            }
            return;
        }

        const previousStart = this.lastValidTermStart;
        const currentStart = this.termStartInput;
        const previousEnd = this.lastValidTermEnd;
        const currentEnd = this.termEndDate;
        const totalEnd = currentEnd ? this.parseDate(currentEnd) : null;

        // 1. Calculate offset if header start date changed
        let dayOffset = 0;
        if (previousStart && currentStart && previousStart !== currentStart) {
            const oldS = this.parseDate(previousStart);
            const newS = this.parseDate(currentStart);
            if (!isNaN(oldS.getTime()) && !isNaN(newS.getTime())) {
                dayOffset = Math.round((newS.getTime() - oldS.getTime()) / (1000 * 60 * 60 * 24));
            }
        }

        // 2. If header end date changed, don't auto-update period (as per request)
        // Validation will occur on save to ensure they match.

        for (let i = 0; i < this.subscriptionPeriods.length; i++) {
            const current = this.subscriptionPeriods[i];

            // Apply offset shift if header start changed
            if (dayOffset !== 0) {
                if (current.startDate) {
                    const s = this.parseDate(current.startDate);
                    s.setDate(s.getDate() + dayOffset);
                    current.startDate = this.toIsoDateString(s);
                }
                if (current.endDate) {
                    const e = this.parseDate(current.endDate);
                    e.setDate(e.getDate() + dayOffset);
                    current.endDate = this.toIsoDateString(e);
                }
            }

            // 1. Set Start Date (Enforce sequence)
            if (i === 0) {
                if (this.termStartInput && (this.currentFrequency === 'Yearly' || current.startDate)) {
                    if (current.startDate !== this.termStartInput) {
                        current.startDate = this.termStartInput;
                    }
                }
            } else {
                const prev = this.subscriptionPeriods[i - 1];
                if (prev.endDate) {
                    const prevEnd = this.parseDate(prev.endDate);
                    const expectedStart = new Date(prevEnd);
                    expectedStart.setDate(expectedStart.getDate() + 1);
                    const expectedStartIso = this.toIsoDateString(expectedStart);

                    // Auto-adjust if not manual or if yearly/shift driven
                    if (this.currentFrequency === 'Yearly' || !current.isManual || dayOffset !== 0) {
                        if (current.startDate !== expectedStartIso) {
                            current.startDate = expectedStartIso;
                        }
                    } else {
                        // Custom & Manual: Show error and clear (Sequential integrity is mandatory)
                        if (current.startDate && current.startDate !== expectedStartIso) {
                            this.toastService.show(`${current.name} start date must be one day after ${prev.name} end date.`, 'error');
                            current.startDate = ''; // Clear for manual adjustment
                        }
                    }
                }
            }

            // 2. Set End Date (Only auto-set for Yearly)
            if (current.startDate) {
                const currentStartObj = this.parseDate(current.startDate);

                if (this.currentFrequency !== 'Custom') {
                    // Standard 1-year end date for Yearly frequency
                    const standardEnd = new Date(currentStartObj);
                    standardEnd.setFullYear(standardEnd.getFullYear() + 1);
                    standardEnd.setDate(standardEnd.getDate() - 1);

                    const targetEndIso = this.toIsoDateString(standardEnd);
                    if (current.endDate !== targetEndIso) {
                        current.endDate = targetEndIso;
                    }
                }

                // Update durationDays
                if (current.startDate && current.endDate) {
                    const s = this.parseDate(current.startDate);
                    const e = this.parseDate(current.endDate);
                    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
                        if (e < s) {
                            this.toastService.show(`${current.name} end date cannot be before start date.`, 'error');
                            current.endDate = current.startDate;
                            return;
                        }
                        const diffTime = Math.abs(e.getTime() - s.getTime());
                        current.durationDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
                    }
                }
            }

            current.name = `Period ${i + 1}`;
        }

        const headerStartChangedByUser = (this.termStartInput !== this.lastValidTermStart);
        const headerEndChangedByUser = (this.termEndDate !== this.lastValidTermEnd);

        // 3. Update Global Subscription End Date
        const lastPeriod = this.subscriptionPeriods[this.subscriptionPeriods.length - 1];
        if (lastPeriod && lastPeriod.endDate) {
            let shouldSyncEnd = false;
            if (this.currentFrequency === 'Yearly') {
                // Auto-slide header end date if it wasn't manually touched
                shouldSyncEnd = !headerEndChangedByUser && this.termEndDate !== lastPeriod.endDate;
            } else {
                // Keep previous stricter logic for Custom
                shouldSyncEnd = !headerEndChangedByUser && !headerStartChangedByUser && this.termEndDate !== lastPeriod.endDate;
            }

            if (shouldSyncEnd) {
                this.termEndDate = lastPeriod.endDate;
            }
        }

        // Recalculate fractional months for the overall subscription header based on current header end date
        if (this.isLookerSubscription && this.termStartInput && this.termEndDate) {
            const fractionalMonths = this.calculateSubscriptionTerm(this.termStartInput, this.termEndDate);
            if (this.commitmentPeriods.length > 0) {
                this.commitmentPeriods[0].months = Math.round(fractionalMonths * 100) / 100;
            }
        }

        this.lastValidTermStart = this.termStartInput;
        this.lastValidTermEnd = this.termEndDate;
    }

    calculatePeriodTotal(p: SubscriptionPeriod): number {
        let total = 0;
        const term = this.calculateSubscriptionTerm(p.startDate, p.endDate);

        if (p.unitPrice && p.productName) {
            total += (p.unitPrice * term) * (1 - (p.discount || 0) / 100);
        }
        p.userRows.forEach(r => {
            if (r.price && r.quantity) {
                total += (r.price * r.quantity * term) * (1 - (r.discount || 0) / 100);
            }
        });
        return total;
    }

    // Expose quote ID for template access
    get salesforceQuoteId(): string | null | undefined {
        return this.contextService.currentContext?.quoteId;
    }

    get isLookerSubscription(): boolean {
        return this.productId === '01tDz00000Ea17zIAB' || (this.productName ? this.productName.includes('Looker') : false);
    }

    ngOnInit() {
        this.lastValidTermStart = this.termStartInput;
        this.lastValidTermEnd = this.termEndDate;
        const now = Date.now();
        QuoteDetailsComponent.lastInitTime = now;

        // Clear Discount/Incentive state when entering from Discovery
        this.discountIncentiveStateService.clearState();
        console.log('🧹 [QuoteDetails] Cleared Discount/Incentive state on entry from Discovery');

        // Initially default Quote Start Date to today
        this.startDate = this.toIsoDateString(new Date());
        this.termStartInput = '';

        // Quote Expiration Date generally defaults to 45 days from today
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 45);
        this.expirationDate = this.toIsoDateString(expiry);

        this.termEndDate = '';


        this.updateBaselineStates();

        this.quoteDataService.quoteData$.subscribe(quoteData => {
            if (quoteData.opportunityName) {
                this.opportunityName = quoteData.opportunityName;
            }
            if (quoteData.accountName) {
                this.accountName = quoteData.accountName;
            }
            if (quoteData.quoteId) {
                this.contextService.updateContext({ quoteId: quoteData.quoteId });
            }
            if (quoteData.quoteName) {
                this.quoteId = quoteData.quoteName;
            }
            if (quoteData.primaryContactName) {
                this.primaryContactName = quoteData.primaryContactName;
                this.contextService.updateContext({ primaryContactName: quoteData.primaryContactName });
            }
            if (quoteData.salesChannel) {
                this.salesChannel = quoteData.salesChannel;
                this.contextService.updateContext({ salesChannel: quoteData.salesChannel });
            }
            if (quoteData.website) {
                this.website = quoteData.website;
            }
            if (quoteData.productName) {
                this.productName = quoteData.productName;
                this.initializeLookerDataIfNeeded();
            }
            if (quoteData.productId) {
                this.productId = quoteData.productId;
            }
            if (quoteData.categoryId) {
                this.categoryId = quoteData.categoryId;
            }
        });

        this.contextService.context$.subscribe(ctx => {
            if (!this.accountName) this.accountName = ctx.accountName;
            if (!this.opportunityName) this.opportunityName = ctx.opportunityName;
            if (ctx.website) this.website = ctx.website;
            if (ctx.primaryContactName && (!this.primaryContactName || this.primaryContactName === 'Sarah Connor')) {
                this.primaryContactName = ctx.primaryContactName;
            }
            if (ctx.salesChannel && (!this.salesChannel || this.salesChannel === 'Partner')) {
                this.salesChannel = ctx.salesChannel;
            }

            // Prefer human-readable quoteName (if it doesn't look like a Salesforce ID)
            if (ctx.quoteId && (!this.quoteId || this.quoteId.startsWith('0Q0'))) {
                this.quoteId = ctx.quoteId;
            }

            this.isGCP = !!ctx.isGCPFamily;
        });

        // Delay the check slightly to ensure product details (and isLookerSubscription) are resolved
        setTimeout(() => {
            this.initializeLookerDataIfNeeded();
            this.updateExpirationDate();
            this.updateBaselineStates();
            this.isLoading = false;
        }, 100);
    }

    loadAllPicklists() {
        const recordTypeId = '012000000000000AAA';

        this.sfApi.getAllPicklistValues('QuoteLineItem', recordTypeId)
            .subscribe({
                next: (response) => {

                    const picklists = response.picklistFieldValues;

                    this.loadLookerRegion(picklists);
                    this.loadOperationType(picklists);
                    this.loadBillingFrequency(picklists);
                    this.loadTermStartsOn(picklists);

                    // Also fetch Product2 picklists specifically for the subscription flow
                    // This fulfills the requirement to call getProductPicklistValues in the subscription flow.
                    this.sfApi.getProductPicklistValues().subscribe({
                        next: (pRes) => console.log('✅ Product2 Picklist values loaded for subscription flow.'),
                        error: (err) => console.error('Error loading Product2 picklists:', err)
                    });
                },
                error: err => console.error('Error loading picklists:', err)
            });
    }
    loadLookerRegion(picklists: any) {

        const data = picklists.Looker_Region__c;

        if (data?.values) {
            this.lookerRegionOptions = data.values.map((v: any) => v.label);
        }

    }
    loadOperationType(picklists: any) {

        const data = picklists.Operation_Type__c;

        if (data?.values) {

            this.operationTypeOptions = data.values.map((v: any) => v.label);

            if (!this.operationType && data.defaultValue) {
                this.operationType = data.defaultValue.label;
            }
            else if (!this.operationType && this.operationTypeOptions.length > 0) {
                this.operationType = this.operationTypeOptions[0];
            }
        }
    }
    loadBillingFrequency(picklists: any) {

        const data = picklists.Billing_Frequency__c;

        if (data?.values) {

            this.billingFrequencyOptions =
                data.values
                    .map((v: any) => v.label);


            if (data.defaultValue?.label) {
                this.billingFrequency = data.defaultValue.label;
            }
            else if (this.billingFrequencyOptions.length > 0) {
                this.billingFrequency = this.billingFrequencyOptions[0];
            }
        }
    }
    loadTermStartsOn(picklists: any) {

        const data = picklists.Term_Starts_On__c;

        if (data?.values) {

            this.termStartsOnOptions =
                data.values.map((v: any) => v.label);

            if (data.defaultValue?.label) {
                this.termStartsOn = data.defaultValue.label;
            }
            else if (!this.termStartsOn && this.termStartsOnOptions.length > 0) {
                this.termStartsOn = this.termStartsOnOptions[0];
            }
        }
    }




    submitQuote() {
        const fullQuoteId = this.contextService.currentContext?.quoteId;

        if (!this.startDate || !this.expirationDate || !fullQuoteId) {
            this.showSuccessPopup = true;
            return;
        }

        this.isSaving = true;
        this.loadingService.show();


        this.sfApi.patchQuoteDates(
            fullQuoteId,
            this.startDate,
            this.expirationDate
        ).subscribe({
            next: (res) => {
                this.isSaving = false;
                this.loadingService.hide();
                this.showSuccessPopup = true;
            },
            error: (err) => {
                this.isSaving = false;
                this.loadingService.hide();
                this.toastService.show('Failed to update quote dates.', 'error');
                console.error('[QuoteDetails] Error:', err);
            }
        });
    }

    openPreview() {
        const fullQuoteId = this.salesforceQuoteId;
        if (!fullQuoteId) {
            this.toastService.show('Quote ID not found', 'error');
            return;
        }

        if (!this.startDate) {
            this.toastService.show('Please select a start date first', 'warning');
            return;
        }

        this.loadingService.show();
        this.fetchQuotePreview(fullQuoteId);
    }

    loadSubscriptionPeriodsFromPreview() {
        if (!this.previewData?.QuoteLineItems?.records) return;

        console.log('🔄 Loading periods from preview data...');
        const lines = this.previewData.QuoteLineItems.records;

        let startDate = this.termStartInput || this.startDate;
        let endDate = this.termEndDate || this.expirationDate;

        const mainLine = lines.find((l: any) => l.Product2?.Name?.includes('Looker') && l.StartDate);
        if (mainLine) {
            startDate = mainLine.StartDate;
            endDate = mainLine.EndDate;
        }

        if (this.subscriptionPeriods.length === 0 && startDate && endDate) {
            this.addOnePeriod(startDate, endDate);
            this.onSubscriptionProductChanged();
        }
    }

    buildPreviewCommitments(): any[] {
        if (this.isLookerSubscription) {
            return this.buildSubscriptionPreview();
        }

        const previews: any[] = [];
        this.matchedPreviewItemIds.clear();

        // 1. PROCESS DISCOUNT PERIODS
        const discountPeriods = this.discountsIncentives?.discountPeriods || [];
        discountPeriods.forEach((period: any, index: number) => {
            const startDateStr = period.startDate;
            const endDateStr = period.endDate;

            const individualItems: any[] = [];
            const groupItems: any[] = [];
            const uploadedItems: any[] = [];

            if (startDateStr) {
                const pStart = new Date(startDateStr).getTime();
                let pEnd: number | null = null;
                if (endDateStr) {
                    pEnd = new Date(endDateStr).setHours(23, 59, 59, 999);
                }

                if (this.previewData?.QuoteLineItems?.records) {
                    const uploadedProductIds = this.discountsIncentives?.bulkUploadedProductIds || new Set();

                    this.previewData.QuoteLineItems.records.forEach((item: any) => {
                        if (item.Id && this.matchedPreviewItemIds.has(item.Id)) return;

                        const isBundle = item.Product2Id === this.productId || (item.Product2?.Id === this.productId);
                        if (isBundle) return;

                        const discount = item.Discount != null ? parseFloat(item.Discount) : 0;
                        if (discount === 0) return;

                        const itemStartStr = item.StartDate;
                        if (itemStartStr) {
                            const itemStartNorm = itemStartStr.substring(0, 10);
                            const periodStartNorm = (startDateStr || '').substring(0, 10);
                            const itemEndStr = item.EndDate;
                            const itemEndNorm = itemEndStr ? itemEndStr.substring(0, 10) : '';
                            const periodEndNorm = endDateStr ? endDateStr.substring(0, 10) : '';

                            let dateMatches = false;
                            if (periodEndNorm && itemEndNorm) {
                                dateMatches = (itemStartNorm === periodStartNorm && itemEndNorm === periodEndNorm);
                            } else {
                                const itemStart = new Date(itemStartStr).getTime();
                                dateMatches = pEnd ? (itemStart >= pStart && itemStart <= pEnd) : (itemStart >= pStart);
                            }

                            if (dateMatches) {
                                if (item.Id) this.matchedPreviewItemIds.add(item.Id);
                                const productId = item.Product2Id || (item.Product2 && item.Product2.Id);

                                if (uploadedProductIds.has(productId)) {
                                    uploadedItems.push(item);
                                } else {
                                    const isGroup = this.isGroupProduct(item);
                                    if (isGroup) {
                                        groupItems.push(item);
                                    } else {
                                        individualItems.push(item);
                                    }
                                }
                            }
                        }
                    });
                }
            }

            previews.push({
                type: 'discount',
                name: `Discount Period ${index + 1}`,
                displayName: `Discount Period ${index + 1}`,
                startDate: startDateStr ? this.formatDateForDisplay(startDateStr) : '',
                endDate: endDateStr ? this.formatDateForDisplay(endDateStr) : '',
                months: period.months || this.commitmentPeriods[index]?.months,
                amount: period.amount,
                bulkIndividualItems: [...individualItems, ...uploadedItems],
                groupItems,
            });
        });

        // 2. PROCESS INCENTIVE PERIODS
        const incentivePeriods = this.discountsIncentives?.incentivePeriods || [];
        incentivePeriods.forEach((period: any, index: number) => {
            const startDateStr = period.startDate;
            const endDateStr = period.endDate;

            const individualItems: any[] = [];
            const groupItems: any[] = [];

            if (startDateStr) {
                const pStart = new Date(startDateStr).getTime();
                let pEnd: number | null = null;
                if (endDateStr) {
                    pEnd = new Date(endDateStr).setHours(23, 59, 59, 999);
                }

                if (this.previewData?.QuoteLineItems?.records && this.discountsIncentives) {
                    const selectedIncentiveGroupNames = new Set(
                        Array.from(this.discountsIncentives.persistentIncentiveGroups.values())
                            .filter((g: any) => g.selected)
                            .map((g: any) => (g.name || '').toLowerCase())
                    );

                    const incentiveProductIds = new Set<string>();
                    Array.from(this.discountsIncentives.persistentIncentiveGroups.values())
                        .filter((g: any) => g.selected)
                        .forEach((g: any) => {
                            (g.components || []).forEach((c: any) => {
                                if (c.id) incentiveProductIds.add(c.id);
                                if (c.productId) incentiveProductIds.add(c.productId);
                            });
                            if (g.id) incentiveProductIds.add(g.id);
                        });

                    period.displayName = 'Incentives';

                    this.previewData.QuoteLineItems.records.forEach((item: any) => {
                        if (item.Id && this.matchedPreviewItemIds.has(item.Id)) return;

                        const isBundle = item.Product2Id === this.productId || (item.Product2?.Id === this.productId);
                        if (isBundle) return;

                        const productId = item.Product2Id || (item.Product2 && item.Product2.Id);
                        const productName = (item.Product2?.Name || item.Product_Name__c || '').toLowerCase();
                        const itemIncentive = item.Incentive__c ? parseFloat(item.Incentive__c) : 0;

                        // Match if explicitly selected in session OR if it has an incentive value and falls within period
                        const sessionMatch = incentiveProductIds.has(productId) || selectedIncentiveGroupNames.has(productName);
                        const dataMatch = itemIncentive > 0;

                        if (sessionMatch || dataMatch) {
                            const itemStartStr = item.StartDate;
                            if (itemStartStr) {
                                const itemStart = new Date(itemStartStr).getTime();
                                if (itemStart >= pStart && (pEnd ? itemStart <= pEnd : true)) {
                                    if (item.Id) this.matchedPreviewItemIds.add(item.Id);

                                    // Logic for display: if it's a group product or matches a selected group name
                                    if (this.isGroupProduct(item) || selectedIncentiveGroupNames.has(productName) || dataMatch) {
                                        groupItems.push(item);
                                    } else {
                                        individualItems.push(item);
                                    }
                                }
                            }
                        }
                    });
                }
            }

            previews.push({
                type: 'incentive',
                name: period.displayName || `Incentive Period`,
                displayName: period.displayName || `Incentive Period`,
                startDate: startDateStr ? this.formatDateForDisplay(startDateStr) : '',
                endDate: endDateStr ? this.formatDateForDisplay(endDateStr) : '',
                months: period.months,
                amount: period.amount,
                bulkIndividualItems: individualItems,
                groupItems,
            });
        });

        // 3. FALLBACK: Subscription Header Periods (For standard quotes showing commitment)
        if (previews.length === 0 && !this.isLookerSubscription && this.commitmentPeriods.length > 0) {
            let currentStartDateFallback = new Date(this.startDate);
            this.commitmentPeriods.forEach((period: any, index: number) => {
                const months = parseInt(period.months) || 0;
                const amount = Number(period.amount) || 0;

                if (months > 0) {
                    const endDate = new Date(currentStartDateFallback);
                    endDate.setMonth(endDate.getMonth() + months);
                    endDate.setDate(endDate.getDate() - 1);

                    const pStart = new Date(currentStartDateFallback).setHours(0, 0, 0, 0);
                    const pEnd = new Date(endDate).setHours(23, 59, 59, 999);

                    const individualItems: any[] = [];
                    const groupItems: any[] = [];

                    if (this.previewData?.QuoteLineItems?.records) {
                        this.previewData.QuoteLineItems.records.forEach((item: any) => {
                            if (item.Id && this.matchedPreviewItemIds.has(item.Id)) return;

                            const isBundle = item.Product2Id === this.productId || (item.Product2?.Id === this.productId);
                            if (isBundle) return;

                            const itemDiscount = item.Discount ? parseFloat(item.Discount) : 0;
                            const itemIncentive = item.Incentive__c ? parseFloat(item.Incentive__c) : 0;

                            if (itemDiscount === 0 && itemIncentive === 0) return;

                            const itemStartStr = item.StartDate;
                            if (itemStartStr) {
                                const itemStart = new Date(itemStartStr).getTime();
                                if (itemStart >= pStart && itemStart <= pEnd) {
                                    if (item.Id) this.matchedPreviewItemIds.add(item.Id);

                                    if (this.isGroupProduct(item)) {
                                        groupItems.push(item);
                                    } else {
                                        individualItems.push(item);
                                    }
                                }
                            }
                        });
                    }

                    previews.push({
                        name: `Period ${index + 1}`,
                        displayName: `Discount Period ${index + 1}`,
                        startDate: this.formatDateForDisplay(currentStartDateFallback),
                        endDate: this.formatDateForDisplay(endDate),
                        months: months,
                        amount: amount,
                        bulkIndividualItems: individualItems,
                        groupItems: groupItems,
                    });

                    currentStartDateFallback = new Date(endDate);
                    currentStartDateFallback.setDate(currentStartDateFallback.getDate() + 1);
                }
            });
        }

        return previews;
    }

    buildProductsWithoutDiscounts(): any[] {
        const productsWithoutDiscounts: any[] = [];
        if (this.previewData?.QuoteLineItems?.records) {
            // Find the bundle product
            const bundle = this.previewData.QuoteLineItems.records.find((item: any) =>
                item.Product2Id === this.productId || (item.Product2 && item.Product2.Id === this.productId)
            );

            if (bundle) {
                // Ensure name is clean (e.g., "Looker" or "Google Cloud Platform RCA")
                const clearName = bundle.Product2?.Name || bundle.Product_Name__c || 'Product';

                productsWithoutDiscounts.push({
                    ...bundle,
                    Product_Name_Display: clearName,
                    Quantity: 1,
                    Discount: 0
                });
            } else {
                // Fallback: If no bundle line found, use the header product name
                productsWithoutDiscounts.push({
                    Product_Name_Display: this.productName || 'Product',
                    Quantity: 1,
                    Discount: 0
                });
            }
        }
        return productsWithoutDiscounts;
    }

    buildSubscriptionPreview(): any[] {
        const previews: any[] = [];
        this.subscriptionPeriods.forEach((period: any, index: number) => {
            const items: any[] = [];
            if (period.productName) {
                const discount = period.discount || 0;
                const price = period.unitPrice || 0;
                const term = this.calculateSubscriptionTerm(period.startDate, period.endDate);
                const displayTerm = this.formatTermDisplay(period.startDate, period.endDate);

                const total = (price * term) * (1 - discount / 100);

                items.push({
                    name: period.productName,
                    operationType: 'New',
                    quantity: 1,
                    startDate: this.formatDateForDisplay(new Date(period.startDate)),
                    endDate: period.endDate ? this.formatDateForDisplay(new Date(period.endDate)) : '-',
                    orderTerm: displayTerm,
                    listPrice: price,
                    discount,
                    total
                });
            }

            period.userRows.forEach((userRow: any) => {
                const qty = userRow.quantity || 0;
                let price = userRow.price || 0;
                if (userRow.type === 'Non-prod' && period.nonProdPrice) {
                    price = period.nonProdPrice;
                }

                if (qty > 0) {
                    const discount = userRow.discount || 0;
                    const term = this.calculateSubscriptionTerm(period.startDate, period.endDate);
                    const displayTerm = this.formatTermDisplay(period.startDate, period.endDate);
                    const total = (price * qty * term) * (1 - discount / 100);
                    const displayName = userRow.name || `${period.productName || 'Looker'} ${userRow.type} ${userRow.type === 'Non-prod' ? 'Environment' : 'User'}`;

                    items.push({
                        name: displayName,
                        operationType: 'New',
                        quantity: qty,
                        startDate: this.formatDateForDisplay(new Date(period.startDate)),
                        endDate: period.endDate ? this.formatDateForDisplay(new Date(period.endDate)) : '-',
                        orderTerm: displayTerm,
                        listPrice: price,
                        discount,
                        total
                    });
                }
            });

            const periodTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);
            if (items.length > 0) {
                const term = this.calculateSubscriptionTerm(period.startDate, period.endDate);
                previews.push({
                    name: `Year ${index + 1}`,
                    startDate: this.formatDateForDisplay(new Date(period.startDate)),
                    endDate: this.formatDateForDisplay(new Date(period.endDate)),
                    months: term,
                    amount: periodTotal,
                    items
                });
            }
        });

        if (previews.length === 0 && this.isLookerSubscription) {
            const start = this.termStartInput || this.startDate;
            const end = this.termEndDate || this.expirationDate;
            if (start) {
                const term = this.calculateSubscriptionTerm(start, end);
                previews.push({
                    name: 'Subscription Period',
                    startDate: this.formatDateForDisplay(new Date(start)),
                    endDate: end ? this.formatDateForDisplay(new Date(end)) : '-',
                    months: term,
                    amount: 0,
                    items: []
                });
            }
        }
        return previews;
    }

    fetchQuotePreview(quoteId: string) {
        this.loadingService.show();
        this.sfApi.getQuotePreview(quoteId).subscribe({
            next: (response: any) => {
                if (response.records && response.records.length > 0) {
                    const quote = response.records[0];
                    if (this.isLookerSubscription && quote.QuoteLineItems?.records) {
                        quote.QuoteLineItems.records.forEach((line: any) => {
                            const isBundle = line.Product2Id === this.productId || (line.Product2 && line.Product2.Id === this.productId);
                            if (isBundle) {
                                if (this.termStartInput) line.StartDate = this.termStartInput;
                                if (this.termEndDate) line.EndDate = this.termEndDate;
                            }
                        });
                    }
                    this.previewData = quote;
                    if (this.isLookerSubscription && this.subscriptionPeriods.length === 0) {
                        this.loadSubscriptionPeriodsFromPreview();
                    }
                    this.previewCommitments = this.buildPreviewCommitments();
                    this.previewProductsWithoutDiscounts = this.buildProductsWithoutDiscounts();
                    this.showPreviewPopup = true;
                }
                this.loadingService.hide();
            },
            error: (err: any) => {
                this.loadingService.hide();
                this.toastService.show('Failed to load quote preview', 'error');
            }
        });
    }

    getProductIcon(): string {
        const name = this.productName.toLowerCase();
        if (name.includes('cloud') || name.includes('gcp')) {
            return 'https://www.gstatic.com/images/branding/product/2x/cloud_64dp.png';
        } else if (name.includes('maps')) {
            return 'https://www.gstatic.com/images/branding/product/2x/maps_64dp.png';
        } else if (name.includes('workspace')) {
            return 'https://www.gstatic.com/images/branding/product/2x/workspace_64dp.png';
        } else if (name.includes('chrome')) {
            return 'https://www.gstatic.com/images/branding/product/2x/chrome_64dp.png';
        }
        return 'https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg';
    }

    closePreview() {
        this.showPreviewPopup = false;
        this.previewData = null;
    }

    capturePreviewScreenshot() {
        const fullQuoteId = this.salesforceQuoteId;
        if (!fullQuoteId) {
            this.showSuccessPopup = true;
            return;
        }

        this.loadingService.show();
        this.sfApi.getQuotePreview(fullQuoteId).subscribe({
            next: (response: any) => {
                if (response.records && response.records.length > 0) {
                    this.previewData = response.records[0];
                    this.previewCommitments = this.buildPreviewCommitments();
                    this.previewProductsWithoutDiscounts = this.buildProductsWithoutDiscounts();

                    this.isCapturingScreenshot = true;
                    this.showPreviewPopup = true;

                    setTimeout(() => {
                        const previewElement = document.querySelector('.bg-white.rounded-2xl.shadow-2xl.max-w-7xl') as HTMLElement;
                        if (previewElement) {
                            html2canvas(previewElement, {
                                scale: 2,
                                logging: false,
                                useCORS: true,
                                backgroundColor: '#ffffff'
                            }).then(canvas => {
                                this.previewScreenshot = canvas.toDataURL('image/png');
                                this.showPreviewPopup = false;
                                this.isCapturingScreenshot = false;
                                this.loadingService.hide();
                                this.showSuccessPopup = true;
                            }).catch(err => {
                                console.error('Screenshot capture failed:', err);
                                this.showPreviewPopup = false;
                                this.isCapturingScreenshot = false;
                                this.loadingService.hide();
                                this.showSuccessPopup = true;
                            });
                        } else {
                            console.warn('Preview element not found for screenshot');
                            this.showPreviewPopup = false;
                            this.isCapturingScreenshot = false;
                            this.loadingService.hide();
                            this.showSuccessPopup = true;
                        }
                    }, 100); // Wait 100ms for rendering
                } else {
                    this.loadingService.hide();
                    this.showSuccessPopup = true;
                }
            },
            error: (err) => {
                console.error('Failed to load quote preview for screenshot:', err);
                this.loadingService.hide();
                this.showSuccessPopup = true;
            }
        });
    }

    // UI Helpers moved to bottom for consolidation


    formatCurrency(value: any): string {
        if (value === null || value === undefined || value === '') return '$0.00';
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
    }

    get totalTerms(): number {
        if (this.isLookerSubscription) {
            // Priority 1: Use the top-level inputs if set, as they define the contract boundaries
            if (this.termStartInput && this.termEndDate) {
                return this.calculateSubscriptionTerm(this.termStartInput, this.termEndDate);
            }
            // Priority 2: Fallback to period boundaries if top-level inputs are missing
            if (this.subscriptionPeriods.length > 0) {
                const first = this.subscriptionPeriods[0];
                const last = this.subscriptionPeriods[this.subscriptionPeriods.length - 1];
                if (first.startDate && last.endDate) {
                    return this.calculateSubscriptionTerm(first.startDate, last.endDate);
                }
            }
            return 0;
        }
        return this.commitmentPeriods.reduce((acc, curr) => acc + (parseInt(curr.months || '0') || 0), 0);
    }

    get totalTermLabel(): string {
        if (this.isLookerSubscription) {
            if (this.termStartInput && this.termEndDate) {
                return this.formatTermDisplay(this.termStartInput, this.termEndDate);
            }
            if (this.subscriptionPeriods.length > 0) {
                const first = this.subscriptionPeriods[0];
                const last = this.subscriptionPeriods[this.subscriptionPeriods.length - 1];
                if (first.startDate && last.endDate) {
                    return this.formatTermDisplay(first.startDate, last.endDate);
                }
            }
            return '0 months';
        }
        return `${this.totalTerms} months`;
    }

    /** The real end of the contract: startDate + totalTerms months.
     *  Used to constrain discount/incentive date pickers. */
    get contractEndDate(): string {
        // For Looker/RCA, prefer the explicit term end date defined in the header
        if (this.isLookerSubscription && this.termEndDate) {
            return this.termEndDate;
        }

        const startToUse = (this.isLookerSubscription && this.termStartInput) ? this.termStartInput : this.startDate;
        if (!startToUse || !this.totalTerms) return '';

        const parts = startToUse.split('-');
        // Use Math.round to handle potential floating point precision issues in totalTerms
        const roundedTerms = Math.round(this.totalTerms);
        const end = new Date(Number(parts[0]), Number(parts[1]) - 1 + roundedTerms, Number(parts[2]));
        end.setDate(end.getDate() - 1); // last day of the term
        return this.toIsoDateString(end);
    }


    get totalContractValue(): number {
        if (this.isLookerSubscription) {
            return this.subscriptionPeriods.reduce((sum, p) => sum + this.calculatePeriodTotal(p), 0);
        }
        return this.commitmentPeriods.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    }

    get commitmentDetailsOnly(): any[] {
        const details: any[] = [];
        const quoteStartDate = this.startDate || new Date().toISOString().split('T')[0];

        // Parse start date using UTC to avoid timezone-related off-by-one errors
        const parts = quoteStartDate.split('-');
        let currentStartDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));

        this.commitmentPeriods.forEach((period, index) => {
            const months = parseInt(period.months) || 0;
            const amount = Number(period.amount) || 0;

            if (months > 0) {
                const endDate = new Date(currentStartDate);
                endDate.setUTCMonth(endDate.getUTCMonth() + months);
                endDate.setUTCDate(endDate.getUTCDate() - 1);

                details.push({
                    name: `Period ${index + 1}`,
                    startDate: this.formatUTCDateForDisplay(currentStartDate),
                    endDate: this.formatUTCDateForDisplay(endDate),
                    months: months,
                    amount: amount
                });

                // Prepare next start date (day after end date)
                currentStartDate = new Date(endDate);
                currentStartDate.setUTCDate(currentStartDate.getUTCDate() + 1);
            }
        });
        return details;
    }

    /** Formats a UTC Date object as M/D/YYYY without timezone shifting */
    formatUTCDateForDisplay(date: Date): string {
        if (!date) return '-';
        return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
    }

    get previewIncentives(): any[] {
        if (!this.previewData?.QuoteLineItems?.records) return [];
        return this.previewData.QuoteLineItems.records
            .filter((item: any) => (Number(item.Incentive__c) || 0) > 0)
            .sort((a: any, b: any) => {
                const dateA = new Date(a.StartDate || 0).getTime();
                const dateB = new Date(b.StartDate || 0).getTime();
                return dateA - dateB;
            });
    }

    get bundleLineItem(): any {
        if (!this.previewData?.QuoteLineItems?.records) return null;
        return this.previewData.QuoteLineItems.records.find((line: any) =>
            line.Product2Id === this.productId || (line.Product2 && line.Product2.Id === this.productId)
        );
    }

    get previewDiscountGroups(): any[] {
        if (!this.previewData?.QuoteLineItems?.records) return [];
        return this.previewData.QuoteLineItems.records.filter((item: any) =>
            (Number(item.Discount) || 0) > 0 && this.isGroupProduct(item)
        );
    }

    get groupedDiscountGroups(): any[] {
        return this.groupByDateRange(this.previewDiscountGroups);
    }

    get previewDiscountIndividuals(): any[] {
        if (!this.previewData?.QuoteLineItems?.records) return [];
        return this.previewData.QuoteLineItems.records.filter((item: any) =>
            (Number(item.Discount) || 0) > 0 && !this.isGroupProduct(item)
        );
    }

    get groupedDiscountIndividuals(): any[] {
        return this.groupByDateRange(this.previewDiscountIndividuals);
    }

    get allUniqueDiscountRanges(): any[] {
        if (!this.previewData?.QuoteLineItems?.records) return [];
        const unique = new Map<string, any>();
        this.previewData.QuoteLineItems.records.forEach((item: any) => {
            if ((Number(item.Discount) || 0) > 0) {
                const key = `${item.StartDate}_${item.EndDate}`;
                if (!unique.has(key)) {
                    unique.set(key, { startDate: item.StartDate, endDate: item.EndDate });
                }
            }
        });
        return Array.from(unique.values()).sort((a, b) => {
            const dateA = new Date(a.startDate || 0).getTime();
            const dateB = new Date(b.startDate || 0).getTime();
            return dateA - dateB;
        });
    }

    getPeriodNumber(startDate: string, endDate: string): number {
        const ranges = this.allUniqueDiscountRanges;
        const index = ranges.findIndex((r: any) => r.startDate === startDate && r.endDate === endDate);
        return index !== -1 ? index + 1 : 1;
    }

    private groupByDateRange(items: any[]): any[] {
        if (!items || items.length === 0) return [];
        const ranges: any[] = [];
        items.forEach(item => {
            const startDate = item.StartDate;
            const endDate = item.EndDate;
            let range = ranges.find(r => r.startDate === startDate && r.endDate === endDate);
            if (!range) {
                range = { startDate, endDate, items: [] };
                ranges.push(range);
            }
            range.items.push(item);
        });

        // Sort ranges chronologically by start date to ensure "Period 1" is the earliest
        ranges.sort((a, b) => {
            const dateA = new Date(a.startDate || 0).getTime();
            const dateB = new Date(b.startDate || 0).getTime();
            return dateA - dateB;
        });

        return ranges;
    }

    private isGroupProduct(item: any): boolean {
        const family = item.Product2?.Family;
        // Group criteria: matches specific "bundle" families or has no family (classification-level bundles)
        if (family === 'Product Group' || !family || family === 'Compute' || family === 'Storage') {
            return true;
        }
        return false;
    }

    private isIndividualProduct(item: any): boolean {
        // Fallback name-based heuristic if family isn't conclusive
        const name = (item.Product2?.Name || '').toLowerCase();
        const individualKeywords = ['dataproc', 'composer', 'vm', 'storage', 'gcs', 'disk', 'dns', 'cdn', 'interconnect'];
        return individualKeywords.some(key => name.includes(key));
    }

    get totalIncentivesValue(): number {
        if (!this.previewData?.QuoteLineItems?.records) return 0;
        return this.previewData.QuoteLineItems.records.reduce((acc: number, item: any) => acc + (Number(item.Incentive__c) || 0), 0);
    }

    /** Formats a monetary value as USD currency.
     * Replaces previous millions-based formatting. */
    formatMillionValue(value: any): string {
        return this.formatCurrency(value);
    }

    buildCommitmentRecords(quoteId: string, quoteLineItemId: string): any[] {
        if (!this.startDate) {
            console.warn('[QuoteDetails] Start date not set, cannot build commitments');
            return [];
        }

        const records: any[] = [];
        const parts = this.startDate.split('-');
        let currentStartDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));

        this.commitmentPeriods.forEach((period: any, index: number) => {
            const months = parseInt(period.months) || 0;
            const amount = Number(period.amount) || 0;

            if (months > 0) {
                const endDate = new Date(currentStartDate);
                endDate.setUTCMonth(endDate.getUTCMonth() + months);
                endDate.setUTCDate(endDate.getUTCDate() - 1);

                records.push({
                    attributes: {
                        type: 'Commitment_Details__c',
                        referenceId: `ref${index + 1}`
                    },
                    Name: `CommitPeriod${index + 1}`,
                    Periods_Months__c: months.toString(),
                    Quote__c: quoteId,
                    Quote_Line_Item__c: quoteLineItemId,
                    Start_Date__c: this.formatDateForSalesforce(currentStartDate),
                    End_Date__c: this.formatDateForSalesforce(endDate),
                    Commit_Amount__c: amount.toString()
                });

                currentStartDate = new Date(endDate);
                currentStartDate.setUTCDate(currentStartDate.getUTCDate() + 1);
            }
        });

        return records;
    }

    formatDateForSalesforce(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    onSkipAndSave() {
        const fullQuoteId = this.contextService.currentContext?.quoteId;
        if (!fullQuoteId) {
            this.toastService.show('Quote ID not found', 'error');
            return;
        }

        if (!this.startDate) {
            this.toastService.show('Please select a start date first', 'warning');
            return;
        }

        // Looker Subscription Validations
        if (this.isLookerSubscription) {
            if (!this.termStartInput || !this.termEndDate) {
                this.toastService.show('Please provide both Subscription Start and End Dates.', 'error');
                return;
            }

            const hasMissingDates = this.subscriptionPeriods.some(p => !p.startDate || !p.endDate);
            if (hasMissingDates) {
                this.toastService.show('Please select dates for all subscription periods.', 'error');
                return;
            }

            if (!this.validateLookerDates()) return;

            // Ensure periods are synced for any existing yearly logic
            this.onSubscriptionProductChanged();
        }

        if (this.isLookerSubscription && this.subscriptionPeriods.length > 0) {
            const currentLookerState = JSON.stringify({
                periods: this.subscriptionPeriods,
                startDate: this.startDate,
                expirationDate: this.expirationDate,
                termStartInput: this.termStartInput,
                termEndDate: this.termEndDate
            });

            if (currentLookerState === this.lastSavedLookerState) {
                // Don't clear values, just show success
                this.showSuccessPopup = true;
                return;
            }

            this.onSave();
        } else if (this.commitmentPeriods.length > 0 && this.commitmentPeriods[0].months) {
            const currentState = JSON.stringify({
                commitments: this.commitmentPeriods,
                startDate: this.startDate,
                expirationDate: this.expirationDate
            });

            if (currentState === this.lastSavedCommitmentState) {
                // Don't clear values, just show success
                this.showSuccessPopup = true;
                return;
            }

            this.executeCommitFlow();
        } else {
            // Even if no periods are configured, preserve the current state
            // and just show success popup without clearing values
            this.showSuccessPopup = true;
        }
    }

    executeCommitFlow(onSuccess?: () => void, skipFeedback: boolean = false) {
        const fullQuoteId = this.contextService.currentContext?.quoteId;
        if (!fullQuoteId) {
            this.toastService.show('Quote ID not found', 'error');
            return;
        }

        this.loadingService.show();

        this.sfApi.getQuoteLineItems(fullQuoteId).pipe(
            switchMap((lineItemsResponse: any) => {
                const quoteLineItems: Array<{ id: string, commitmentAmount: number }> = [];

                if (lineItemsResponse.records && lineItemsResponse.records.length > 0) {
                    const firstLineItem = lineItemsResponse.records[0];
                    const firstLineItemId = firstLineItem.Id;
                    this.bundleQuoteLineId = firstLineItemId;
                    quoteLineItems.push({
                        id: firstLineItemId,
                        commitmentAmount: this.totalContractValue
                    });
                } else {
                    throw new Error('No QuoteLineItems found');
                }


                if (this.startDate && this.expirationDate) {
                    return this.sfApi.updateQuoteDates(
                        fullQuoteId,
                        this.startDate,
                        this.expirationDate,
                        this.totalTerms,
                        this.totalContractValue,
                        quoteLineItems
                    ).pipe(
                        map(() => lineItemsResponse)
                    );
                } else {
                    return of(lineItemsResponse);
                }
            }),
            switchMap((lineItemsResponse: any) => {
                const firstLineItemId = lineItemsResponse.records[0].Id;
                const commitmentRecords = this.buildCommitmentRecords(fullQuoteId, firstLineItemId);

                if (commitmentRecords.length > 0) {
                    return this.sfApi.createQuoteLineCommitments(commitmentRecords);
                } else {
                    return new Observable(observer => {
                        observer.next({ success: true, message: 'No commitments to create' });
                        observer.complete();
                    });
                }
            })
        ).subscribe({
            next: (commitmentResponse: any) => {
                this.loadingService.hide();
                this.lastSavedCommitmentState = JSON.stringify({
                    commitments: this.commitmentPeriods,
                    startDate: this.startDate,
                    expirationDate: this.expirationDate
                });

                if (!skipFeedback) {
                    this.toastService.show('Quote Data Saved Successfully!', 'success');
                    this.showSuccessPopup = true;
                    // Clear state after successful submit
                    this.discountIncentiveStateService.clearState();
                }
                if (onSuccess) onSuccess();
            },
            error: (err) => {
                this.loadingService.hide();
                this.toastService.show('Failed to save quote', 'error');
                console.error('[QuoteDetails] Error:', err);
            }
        });
    }



    addPeriod() {
        if (this.commitmentPeriods.length < 5) {
            // Check if any existing period is missing months or amount
            const lastPeriodIndex = this.commitmentPeriods.length - 1;
            const lastPeriod = this.commitmentPeriods[lastPeriodIndex];

            if (lastPeriod && (!lastPeriod.months || !lastPeriod.amount)) {
                this.toastService.show(`Please fill the Commit Period ${this.commitmentPeriods.length} details first`, 'warning');
                return;
            }

            this.commitmentPeriods.push({ months: null, amount: null, isCollapsed: false });
            // Only update if we have a start date
            if (this.startDate) {
                this.updateExpirationDate();
            }
        }
    }

    removePeriod() {
        if (this.commitmentPeriods.length > 1) {
            this.commitmentPeriods.pop();
            this.updateExpirationDate();
        }
    }

    toggleEdit(index: number) {
        this.commitmentPeriods[index].isCollapsed = !this.commitmentPeriods[index].isCollapsed;
    }

    duplicatePeriod(index: number) {
        if (this.commitmentPeriods.length >= 5) return;
        const org = this.commitmentPeriods[index];
        this.commitmentPeriods.push({ ...org, isDuplicated: true });
        this.activeMenuIndex = null;
        this.updateExpirationDate();
    }

    formatDateForDisplay(dateString: any): string {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    }

    deletePeriod(index: number) {
        if (this.commitmentPeriods.length > 1) {
            this.commitmentPeriods.splice(index, 1);
            this.activeMenuIndex = null;
            this.updateExpirationDate();
        }
    }

    toggleMenu(index: number, event: Event) {
        event.stopPropagation();
        this.activeMenuIndex = this.activeMenuIndex === index ? null : index;
    }

    @HostListener('document:click')
    closeMenu() {
        this.activeMenuIndex = null;
        this.primaryContactOpen = false;
        this.salesChannelOpen = false;
        this.operationTypeOpen = false;
        this.billingFrequencyOpen = false;
        this.termStartsOnOpen = false;
    }

    checkCollapse(index: number, event: FocusEvent) { }

    private checkAndDefaultExpirationDate() {
        if (this.isLookerSubscription && !this.expirationDate) {
            const expiry = new Date();
            expiry.setDate(expiry.getDate() + 45);
            this.expirationDate = this.toIsoDateString(expiry);
            console.log('📅 Automatically set Looker subscription expiration date to 45 days from now:', this.expirationDate);
        }
    }

    // Input handlers for commitment periods
    onMonthFocus(index: number, el: HTMLElement) { }
    onMonthBlur(index: number, el: HTMLElement) {
        const val = (el as HTMLInputElement).value;
        this.commitmentPeriods[index].months = val.replace(/[^0-9]/g, '');
        this.updateExpirationDate();
    }
    onMonthInput(index: number, val: string) { }

    updateExpirationDate() {
        if (this.isLookerSubscription) {
            this.updateTermFromDates();
            return;
        }

        if (!this.startDate) {
            this.expirationDate = '';
            return;
        }

        if (this.startDate && this.startDate < this.minDate) {
            this.toastService.show('Quote Start Date cannot be less than the current date.', 'warning');
            this.startDate = this.minDate;
        }

        // Quote Expiration Date is generally 45 days from Quote Start Date
        const parts = this.startDate.split('-');
        const expiry = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        expiry.setDate(expiry.getDate() + 45);
        this.expirationDate = this.toIsoDateString(expiry);
    }


    updateTermFromDates() {
        if (!this.termStartInput || !this.termEndDate) return;

        const startParts = this.termStartInput.split('-').map(Number);
        const endParts = this.termEndDate.split('-').map(Number);

        const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
        const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

        if (end < start) {
            this.toastService.show('Term End Date cannot be earlier than Term Start Date.', 'error');
            const startVal = this.lastValidTermStart;
            const endVal = this.lastValidTermEnd;
            setTimeout(() => {
                this.termStartInput = startVal;
                this.termEndDate = endVal;
            });
            return;
        }

        // Check if duration > 5 years
        const limitDate = new Date(start);
        limitDate.setFullYear(limitDate.getFullYear() + 5);

        // If end date is strictly after limit date (start + 5 years), then it's > 5 years
        // Example: Start 2026-01-01. Limit 2031-01-01. End 2031-01-02 is > 5 years.
        if (end > limitDate) {
            this.toastService.show('The duration between start and end dates cannot exceed 5 years.', 'warning');
            const startVal = this.lastValidTermStart;
            const endVal = this.lastValidTermEnd;
            setTimeout(() => {
                this.termStartInput = startVal;
                this.termEndDate = endVal;
            });
            return;
        }

        // Calculate difference in months
        let months = (end.getFullYear() - start.getFullYear()) * 12;
        months -= start.getMonth();
        months += end.getMonth();


        if (this.isLookerSubscription) {
            const fractionalMonths = this.calculateSubscriptionTerm(this.termStartInput, this.termEndDate);
            if (this.commitmentPeriods.length === 0) {
                this.commitmentPeriods.push({ months: fractionalMonths, amount: null, isCollapsed: false });
            } else {
                this.commitmentPeriods[0].months = fractionalMonths;
            }
            // Sequentially adjust existing subscription periods
            this.onSubscriptionProductChanged();
            return;
        }

        const endAdjusted = new Date(end);
        endAdjusted.setDate(endAdjusted.getDate() + 1);

        let diffMonths = (endAdjusted.getFullYear() - start.getFullYear()) * 12 + (endAdjusted.getMonth() - start.getMonth());

        if (diffMonths < 1) diffMonths = 1;

        if (this.commitmentPeriods.length === 0) {
            this.commitmentPeriods.push({ months: diffMonths, amount: null, isCollapsed: false });
        } else {
            this.commitmentPeriods[0].months = diffMonths;
        }
    }

    onAmountBlur(index: number, val: string) {
        this.commitmentPeriods[index].amount = this.parseShorthandValue(val);
    }

    parseShorthandValue(val: string): number {
        if (!val) return 0;

        let cleaned = val.toLowerCase().replace(/[^0-9.kmb]/g, '');
        if (!cleaned) return 0;

        // Check for shorthand character anywhere (though usually at the end)
        let multiplier = 1;
        if (cleaned.includes('k')) {
            multiplier = 1000;
            cleaned = cleaned.replace('k', '');
        } else if (cleaned.includes('m')) {
            multiplier = 1000000;
            cleaned = cleaned.replace('m', '');
        } else if (cleaned.includes('b')) {
            multiplier = 1000000000;
            cleaned = cleaned.replace('b', '');
        }

        const numValue = parseFloat(cleaned);
        return isNaN(numValue) ? 0 : numValue * multiplier;
    }

    handleInputEnter(index: number, field: string, event: Event, ...others: any[]) {
        const val = (event.target as HTMLInputElement).value;
        if (field === 'amount') {
            this.commitmentPeriods[index].amount = this.parseShorthandValue(val);
        } else if (field === 'months') {
            this.commitmentPeriods[index].months = val.replace(/[^0-9]/g, '');
            this.updateExpirationDate();
        }

        (event.target as HTMLElement).blur();

        if (others.length > 0 && others[0] instanceof HTMLElement) {
            others[0].focus();
        } else {
            this.commitmentPeriods[index].isCollapsed = true;
        }
    }

    closePopup() {
        this.showSuccessPopup = false;
        this.cartService.clearCart();
        this.quoteDataService.clearQuoteData();
        this.resetForm();
        this.router.navigate(['/']);
    }

    // Dropdown Helpers for Subscription Flow
    closeAllDropdowns() {
        this.operationTypeOpen = false;
        this.billingFrequencyOpen = false;
        this.termStartsOnOpen = false;
        this.primaryContactOpen = false;
        this.salesChannelOpen = false;
    }

    toggleOperationType() {
        const wasOpen = this.operationTypeOpen;
        this.closeAllDropdowns();
        this.operationTypeOpen = !wasOpen;
    }

    toggleBillingFrequency() {
        const wasOpen = this.billingFrequencyOpen;
        this.closeAllDropdowns();
        this.billingFrequencyOpen = !wasOpen;
    }

    toggleTermStartsOn() {
        const wasOpen = this.termStartsOnOpen;
        this.closeAllDropdowns();
        this.termStartsOnOpen = !wasOpen;
    }

    togglePrimaryContact() {
        const wasOpen = this.primaryContactOpen;
        this.closeAllDropdowns();
        this.primaryContactOpen = !wasOpen;
    }

    toggleSalesChannel() {
        const wasOpen = this.salesChannelOpen;
        this.closeAllDropdowns();
        this.salesChannelOpen = !wasOpen;
    }

    selectOperationType(type: string) {
        this.operationType = type;
        this.operationTypeOpen = false;
    }

    selectBillingFrequency(freq: string) {
        this.billingFrequency = freq;
        this.billingFrequencyOpen = false;
    }

    selectTermStartsOn(option: string) {
        this.termStartsOn = option;
        this.termStartsOnOpen = false;
        if (this.isTermStartDateDisabled()) {
            this.termStartDate = '';
        }
    }

    selectContact(contact: string) {
        this.primaryContactName = contact;
        this.primaryContactOpen = false;
    }

    selectChannel(channel: string) {
        this.salesChannel = channel;
        this.salesChannelOpen = false;
    }

    isTermStartDateDisabled(): boolean {
        if (!this.termStartsOn) return false;
        const val = this.termStartsOn.toLowerCase().replace(/\s/g, '');
        return val === 'uponprovisioning' || val === 'customersignaturedate';
    }

    formatDate(dateStr: string): string {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();

        return `${month} ${day},${year}`;
    }

    onSave(onSuccess?: () => void, skipFeedback: boolean = false) {
        console.log('🚀 Initiating Consolidated Quote Update (Full Graph API)...');
        if (this.isSaving) return;

        // Validation and Sync for Looker Subscriptions
        if (this.isLookerSubscription) {
            this.syncAllPeriodUserProducts();
            if (!this.validateLookerDates()) return;
        }

        this.isSaving = true;
        this.loadingService.show();

        const targetQuoteId = this.salesforceQuoteId;
        if (!targetQuoteId) {
            this.toastService.show('Quote ID not found.', 'error');
            this.isSaving = false;
            this.loadingService.hide();
            return;
        }

        const relType$ = this.productRelationshipTypeId
            ? of({ recentItems: [{ Id: this.productRelationshipTypeId, Name: 'Bundle to Bundle Component Relationship' }] })
            : this.sfApi.getProductRelationshipType();

        forkJoin({
            lineItemRes: this.sfApi.getQuoteLineItems(targetQuoteId),
            relTypeRes: relType$
        }).subscribe({
            next: (data) => {
                const lineItems = data.lineItemRes.records || [];
                this.extractRelationshipId(data.relTypeRes);
                const relationshipTypeId = this.productRelationshipTypeId || '0yoKf0000010wFiIAI';

                const bundleProductId = this.productId;
                const bundleLine = lineItems.find((item: any) => item.Product2Id === bundleProductId);
                const bundlePBEId = bundleLine ? bundleLine.PricebookEntryId : this.bundlePricebookEntryId;
                const mainLineId = bundleLine?.Id || (lineItems.length > 0 ? lineItems[0].Id : null);

                const records: any[] = [];

                // 1. Quote Update
                const startToUse = (this.isLookerSubscription && this.termStartInput) ? this.termStartInput : (this.startDate || this.toIsoDateString(new Date()));
                const quoteRec: any = {
                    "attributes": { "type": "Quote", "method": "PATCH", "id": targetQuoteId },
                    "StartDate": startToUse
                };
                if (this.expirationDate) quoteRec["ExpirationDate"] = this.expirationDate;

                records.push({
                    "referenceId": "refQuote",
                    "record": quoteRec
                });

                if (this.subscriptionPeriods.length === 0) {
                    this.isSaving = false;
                    this.loadingService.hide();
                    this.toastService.show('Error: No subscription periods found to sync.', 'error');
                    return;
                }

                // --- Year 1 Implementation ---
                const firstPeriod = this.subscriptionPeriods[0];
                const isRamped = this.subscriptionPeriods.length > 1;
                const year1GroupRef = "refGroup1";

                if (isRamped) {
                    records.push({
                        "referenceId": year1GroupRef,
                        "record": {
                            "attributes": { "type": "QuoteLineGroup", "method": "POST" },
                            "SortOrder": 1,
                            "Name": "Year 1",
                            "QuoteId": targetQuoteId,
                            "IsRamped": true,
                            "SegmentType": "Yearly",
                            "StartDate": firstPeriod.startDate,
                            "EndDate": firstPeriod.endDate
                        }
                    });
                }

                lineItems.forEach((item: any, index: number) => {
                    const startToUse = (this.isLookerSubscription && this.termStartInput) ? this.termStartInput : this.startDate;
                    const subTerm = this.calculateSubscriptionTerm(startToUse, firstPeriod.endDate);

                    const lineUpdate: any = {
                        "attributes": { "type": "QuoteLineItem", "method": "PATCH", "id": item.Id },
                        "SortOrder": 1,
                        "Term_Starts_On__c": this.termStartsOn,
                        "Operation_Type__c": this.operationType,
                        "Billing_Frequency__c": this.billingFrequency,
                        "SubscriptionTerm": subTerm,
                        "SubscriptionTermUnit": "Months",
                        "PeriodBoundary": "Anniversary"
                    };

                    if (isRamped) {
                        lineUpdate["QuoteLineGroupId"] = `@{${year1GroupRef}.id}`;
                    }

                    if (this.isLookerSubscription && this.termStartInput) {
                        lineUpdate["StartDate"] = this.termStartInput;
                    } else if (this.startDate) {
                        lineUpdate["StartDate"] = this.startDate;
                    }

                    if (firstPeriod.endDate) {
                        lineUpdate["EndDate"] = firstPeriod.endDate;
                    }

                    records.push({
                        "referenceId": `refLineUpdate_${index}`,
                        "record": lineUpdate
                    });
                });

                if (mainLineId) {
                    let childIdx = 1;
                    const selectedPlatform = this.productOptions.find(p => p.name === firstPeriod.productName);
                    const groupId = isRamped ? `@{${year1GroupRef}.id}` : null;

                    if (selectedPlatform && selectedPlatform.productId) {
                        this.addGraphRecords(records, childIdx++, selectedPlatform, firstPeriod, mainLineId, 1, targetQuoteId, 'NotIncludedInBundlePrice', firstPeriod.discount || 0, '_P1', groupId, relationshipTypeId);
                    }
                    firstPeriod.userRows.forEach(row => {
                        if (row.type !== 'Non-prod' && (row.quantity || 0) > 0 && row.productId) {
                            this.addGraphRecords(records, childIdx++, row, firstPeriod, mainLineId, row.quantity || 0, targetQuoteId, 'NotIncludedInBundlePrice', row.discount || 0, '_P1', groupId, relationshipTypeId);
                        }
                    });
                    const nonProdRow = firstPeriod.userRows.find(r => r.type === 'Non-prod');
                    if (nonProdRow && (nonProdRow.quantity || 0) > 0 && selectedPlatform?.nonProdProductId) {
                        const matchingItem = {
                            ...nonProdRow,
                            productId: selectedPlatform.nonProdProductId,
                            pricebookEntryId: (selectedPlatform as any).nonProdPricebookEntryId
                        };
                        this.addGraphRecords(records, childIdx++, matchingItem, firstPeriod, mainLineId, nonProdRow.quantity || 0, targetQuoteId, 'NotIncludedInBundlePrice', nonProdRow.discount || 0, '_P1', groupId, relationshipTypeId);
                    }
                }

                // --- Ramp Periods (Years 2+) ---
                if (this.subscriptionPeriods.length > 1) {
                    this.subscriptionPeriods.slice(1).forEach((period, idx) => {
                        const periodNum = idx + 2;
                        const groupRef = `refRampGroup_P${periodNum}`;
                        const bundleParentRef = `refBundleParent_P${periodNum}`;

                        records.push({
                            "referenceId": groupRef,
                            "record": {
                                "attributes": { "type": "QuoteLineGroup", "method": "POST" },
                                "SortOrder": periodNum,
                                "QuoteId": targetQuoteId,
                                "Name": period.name.replace('Period', 'Year'),
                                "IsRamped": true,
                                "SegmentType": "Yearly",
                                "StartDate": period.startDate,
                                "EndDate": period.endDate
                            }
                        });

                        const subTerm = this.calculateSubscriptionTerm(period.startDate, period.endDate);
                        const standardFreq = this.billingFrequency ? this.billingFrequency.split(' ')[0] : 'Monthly';
                        records.push({
                            "referenceId": bundleParentRef,
                            "record": {
                                "attributes": { "type": "QuoteLineItem", "method": "POST" },
                                "SortOrder": 1,
                                "QuoteId": targetQuoteId,
                                "Product2Id": bundleProductId,
                                "PricebookEntryId": bundlePBEId,
                                "Quantity": 1,
                                "BillingFrequency": standardFreq,
                                "Billing_Frequency__c": this.billingFrequency,
                                "Operation_Type__c": this.operationType,
                                "Term_Starts_On__c": this.termStartsOn,
                                "SubscriptionTerm": subTerm,
                                "SubscriptionTermUnit": "Months",
                                "PeriodBoundary": "Anniversary",
                                "StartDate": period.startDate,
                                "EndDate": period.endDate,
                                "QuoteLineGroupId": `@{${groupRef}.id}`
                            }
                        });

                        let childIdx = 1;
                        const selectedPlatform = this.productOptions.find(p => p.name === period.productName);
                        if (selectedPlatform && selectedPlatform.productId) {
                            this.addGraphRecords(records, childIdx++, selectedPlatform, period, `@{${bundleParentRef}.id}`, 1, targetQuoteId, "NotIncludedInBundlePrice", period.discount || 0, `_P${periodNum}`, `@{${groupRef}.id}`, relationshipTypeId);
                        }
                        period.userRows.forEach(row => {
                            if (row.type !== 'Non-prod' && (row.quantity || 0) > 0 && row.productId) {
                                this.addGraphRecords(records, childIdx++, row, period, `@{${bundleParentRef}.id}`, row.quantity || 0, targetQuoteId, "NotIncludedInBundlePrice", row.discount || 0, `_P${periodNum}`, `@{${groupRef}.id}`, relationshipTypeId);
                            }
                        });

                        const nonProdRow = period.userRows.find(r => r.type === 'Non-prod');
                        if (nonProdRow && (nonProdRow.quantity || 0) > 0 && selectedPlatform?.nonProdProductId) {
                            const matchingItem = {
                                ...nonProdRow,
                                productId: selectedPlatform.nonProdProductId,
                                pricebookEntryId: (selectedPlatform as any).nonProdPricebookEntryId
                            };
                            this.addGraphRecords(records, childIdx++, matchingItem, period, `@{${bundleParentRef}.id}`, nonProdRow.quantity || 0, targetQuoteId, "NotIncludedInBundlePrice", nonProdRow.discount || 0, `_P${periodNum}`, `@{${groupRef}.id}`, relationshipTypeId);
                        }
                    });
                }

                const finalPayload = {
                    "pricingPref": "System",
                    "catalogRatesPref": "Skip",
                    "configurationPref": {
                        "configurationMethod": "Skip",
                        "configurationOptions": {
                            "validateProductCatalog": true,
                            "validateAmendRenewCancel": true,
                            "executeConfigurationRules": true,
                            "addDefaultConfiguration": false
                        }
                    },
                    "taxPref": "Skip",
                    "contextDetails": {},
                    "graph": {
                        "graphId": "updateQuote",
                        "records": records
                    }
                };

                console.log('📦 Consolidated Graph Payload:', JSON.stringify(finalPayload, null, 2));

                this.sfApi.placeGraphRequest(finalPayload).subscribe({
                    next: (res) => {
                        this.isSaving = false;
                        this.loadingService.hide();

                        this.lastSavedLookerState = JSON.stringify({
                            periods: this.subscriptionPeriods,
                            startDate: this.startDate,
                            expirationDate: this.expirationDate,
                            termStartInput: this.termStartInput,
                            termEndDate: this.termEndDate
                        });

                        if (!skipFeedback) {
                            this.toastService.show('Quote Data Saved Successfully!', 'success');
                            this.showSuccessPopup = true;
                        }
                        if (onSuccess) onSuccess();
                    },

                    error: (err) => {
                        console.error('❌ Consolidated Sync error:', err);
                        this.isSaving = false;
                        this.loadingService.hide();
                        this.toastService.show('Failed to save quote data.', 'error');
                    }
                });
            },
            error: (err) => {
                console.error('❌ Error fetching requirements:', err);
                this.isSaving = false;
                this.loadingService.hide();
                this.toastService.show('Failed to fetch quote details.', 'error');
            }
        });
    }

    addGraphRecords(records: any[], index: number, item: any, period: SubscriptionPeriod, parentId: string, quantity: number, quoteId: string, pricing: string, discount: number = 0, suffix: string = '', groupId: string | null = null, productRelationshipTypeId: string | null = null) {
        const refIdStr = index === 1 ? '' : `-${index}`;
        const refId = `refChildQuoteLineItem${suffix}${refIdStr}`;

        const standardFreq = this.billingFrequency ? this.billingFrequency.split(' ')[0] : 'Monthly';

        const subTerm = this.calculateSubscriptionTerm(period.startDate, period.endDate);
        const record: any = {
            "referenceId": refId,
            "record": {
                "attributes": { "type": "QuoteLineItem", "method": "POST" },
                "SortOrder": index + 1,
                "QuoteId": quoteId,
                "Product2Id": item.productId,
                "PricebookEntryId": item.pricebookEntryId || this.bundlePricebookEntryId,
                "Quantity": quantity,
                "SubscriptionTerm": subTerm,
                "SubscriptionTermUnit": "Months",
                "PeriodBoundary": "Anniversary",
                "BillingFrequency": standardFreq,
                "Billing_Frequency__c": this.billingFrequency,
                "Operation_Type__c": this.operationType,
                "Term_Starts_On__c": this.termStartsOn,
                "StartDate": period.startDate,
                "EndDate": period.endDate
            }
        };

        if (groupId) {
            record.record["QuoteLineGroupId"] = groupId;
        }

        if (discount > 0) {
            record.record["Discount"] = discount;
        }

        if (item.lookerInstanceId) {
            record.record["Looker_Instance_Id__c"] = item.lookerInstanceId;
        }

        if (item.gcpProjectId) {
            record.record["GCP_Project_Id__c"] = item.gcpProjectId;
        }

        if (item.region) {
            record.record["Looker_Region__c"] = item.region;
        }

        records.push(record);

        if (parentId && productRelationshipTypeId) {
            records.push({
                "referenceId": `refRel${suffix}_${index}`,
                "record": {
                    "attributes": { "type": "QuoteLineRelationship", "method": "POST" },
                    "MainQuoteLineId": parentId,
                    "AssociatedQuoteLineId": `@{${refId}.id}`,
                    "ProductRelationshipTypeId": productRelationshipTypeId,
                    "AssociatedQuoteLinePricing": pricing
                }
            });
        }
    }


    resetForm() {
        this.startDate = this.toIsoDateString(new Date());
        this.expirationDate = '';
        this.updateExpirationDate();
        this.commitmentPeriods = [{ months: null, amount: null, isCollapsed: false }];
        this.activeMenuIndex = null;
    }
    restrictNumeric(event: KeyboardEvent) {
        const allowedKeys = ['Backspace', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'Delete', 'End', 'Home'];
        if (allowedKeys.includes(event.key)) return;

        const isDigit = /[0-9]/.test(event.key);
        const isDot = event.key === '.';
        const isShorthand = /[kmbKMB]/.test(event.key);

        if (!isDigit && !isDot && !isShorthand) {
            event.preventDefault();
        }

        if (isDot && (event.target as HTMLInputElement).value.includes('.')) {
            event.preventDefault();
        }

        // Only allow one shorthand character
        if (isShorthand && /[kmbKMB]/.test((event.target as HTMLInputElement).value)) {
            event.preventDefault();
        }
    }

    private validateLookerDates(): boolean {
        if (!this.isLookerSubscription) return true;

        if (this.subscriptionPeriods.length === 0) {
            this.toastService.show('Please create at least one subscription period.', 'warning');
            return false;
        }

        const firstPeriod = this.subscriptionPeriods[0];
        const lastPeriod = this.subscriptionPeriods[this.subscriptionPeriods.length - 1];

        if (!firstPeriod.startDate || firstPeriod.startDate !== this.termStartInput) {
            this.toastService.show('Error: The start date of Period 1 must match the Subscription Start Date.', 'error');
            return false;
        }

        // 1. Duration exactly in years (for Yearly)
        if (this.currentFrequency === 'Yearly' && this.termStartInput && this.termEndDate) {
            const startObj = this.parseDate(this.termStartInput);
            let years = Math.round(this.calculateSubscriptionTerm(this.termStartInput, this.termEndDate) / 12);
            if (years < 1) years = 1;

            const expectedEnd = new Date(startObj);
            expectedEnd.setFullYear(expectedEnd.getFullYear() + years);
            expectedEnd.setDate(expectedEnd.getDate() - 1);

            if (this.toIsoDateString(expectedEnd) !== this.termEndDate) {
                this.toastService.show('Error: For Yearly periods, the total duration must be exactly in full years.', 'error');
                return false;
            }
        }

        // 2. Deletion check (Extra period found) - checked before generic mismatch to allow specific message
        if (lastPeriod && this.termEndDate) {
            const subEnd = this.parseDate(this.termEndDate);
            const lastStart = this.parseDate(lastPeriod.startDate);

            if (!isNaN(subEnd.getTime()) && !isNaN(lastStart.getTime()) && subEnd < lastStart) {
                this.toastService.show('Extra period found. Delete that or adjust subscription end date.', 'error');
                return false;
            }
        }

        // 3. Generic end date matching
        if (!lastPeriod.endDate || lastPeriod.endDate !== this.termEndDate) {
            this.toastService.show('Error: The end date of the last period must match the Subscription End Date.', 'error');
            return false;
        }

        // 4. Platform product 
        const hasMissingProduct = this.subscriptionPeriods.some(p => !p.productName);
        if (hasMissingProduct) {
            this.toastService.show('you should select a platform product for all periods', 'error');
            return false;
        }

        return true;
    }

    /** Ensures all Viewer, Standard, and Developer rows in all periods have their correct product IDs and PBEs. */
    private syncAllPeriodUserProducts() {
        if (!this.subscriptionPeriods || this.subscriptionPeriods.length === 0) return;

        this.subscriptionPeriods.forEach(p => {
            p.userRows.forEach(r => {
                // Skip non-prod as it's handled differently based on the selected platform product
                if (r.type === 'Non-prod') return;

                if (r.type === 'Viewer') {
                    r.productId = this.viewerUserProductId;
                    r.pricebookEntryId = this.viewerUserPBEId;
                    r.name = this.viewerUserName;
                    r.price = this.viewerUserPrice;
                } else if (r.type === 'Standard') {
                    r.productId = this.standardUserProductId;
                    r.pricebookEntryId = this.standardUserPBEId;
                    r.name = this.standardUserName;
                    r.price = this.standardUserPrice;
                } else if (r.type === 'Developer') {
                    r.productId = this.developerUserProductId;
                    r.pricebookEntryId = this.developerUserPBEId;
                    r.name = this.developerUserName;
                    r.price = this.developerUserPrice;
                }
            });
        });
    }
}

