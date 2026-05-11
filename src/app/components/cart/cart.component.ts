import { Component, Input, inject, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { SalesforceApiService } from '../../services/salesforce-api.service';
import { QuoteDataService } from '../../services/quote-data.service';
import { forkJoin, Observable } from 'rxjs';
import { switchMap, finalize } from 'rxjs/operators';
import { LoadingService } from '../../services/loading.service';
import { SearchFilterService } from '../../services/search-filter.service'; // Import SearchFilterService

@Component({
    selector: 'app-cart',
    standalone: true,
    imports: [CommonModule, RouterModule],
    templateUrl: './cart.component.html',
})
export class CartComponent implements AfterViewInit, OnChanges {
    @Input() opportunityId: string | null = null;

    private router = inject(Router);
    cartService = inject(CartService);
    private salesforceApi = inject(SalesforceApiService);
    private quoteDataService = inject(QuoteDataService);
    private loadingService = inject(LoadingService);
    private searchFilterService = inject(SearchFilterService); // Inject SearchFilterService
    cartItems$ = this.cartService.cartItems$;

    // Store API responses for later use
    private opportunityData: any = null;
    private accountData: any = null;

    ngOnChanges(changes: SimpleChanges): void {
        // No op
    }

    ngAfterViewInit(): void {
        // No op
    }

    removeItem(productId: string) {
        this.cartService.removeFromCart(productId);
    }

    closeCart() {
        this.cartService.clearCart();
    }

    isSubmitting = false;

    onContinue() {
        if (this.isSubmitting) return;

        const quoteData = this.quoteDataService.getQuoteData();
        if (!quoteData.opportunityId) {
            this.router.navigate(['/']);
            return;
        }

        const cartItems = this.cartService.getCartItems();
        if (cartItems.length === 0) return;

        if (!quoteData.pricebook2Id) {
            throw new Error('Missing Pricebook2Id on Opportunity');
        }

        this.isSubmitting = true;
        this.loadingService.show();

        let apiCall: Observable<any>;

        if (quoteData.quoteId) {
            // Case: Update EXISTING Quote (Don't add products as lines on continue)
            const records: any[] = [
                {
                    "referenceId": "refQuote",
                    "record": {
                        "attributes": {
                            "method": "PATCH",
                            "type": "Quote",
                            "id": quoteData.quoteId
                        }
                    }
                }
            ];

            // Removed: cartItems.forEach loop to add QuoteLineItems as per request


            const payload = {
                "pricingPref": "System",
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
                "graph": {
                    "graphId": "createQuote",
                    "records": records
                }
            };

            apiCall = this.salesforceApi.placeSalesTransaction(payload);
        } else {
            // Case: Create NEW Quote (existing logic)
            apiCall = this.salesforceApi.createQuote(
                quoteData.opportunityId,
                quoteData.pricebook2Id,
                [] // Don't add products during creation
            );
        }

        apiCall.pipe(
            switchMap((quoteResult: any) => {
                const quoteId = quoteResult.salesTransactionId || quoteData.quoteId;
                if ((quoteResult.isSuccess || quoteResult.success) && quoteId) {
                    
                    // Store initial Quote ID
                    this.quoteDataService.setQuoteData({
                        quoteId: quoteId
                    });

                    return this.salesforceApi.loadConfiguratorInstance(quoteId).pipe(
                        switchMap((loadRes: any) => {
                            const contextId = loadRes.contextId;
                            if (!contextId) throw new Error('No contextId received from load-instance');
                            return forkJoin({
                                quote: this.salesforceApi.getConfiguratorInstance(contextId),
                                quoteId: quoteId
                            });
                        })
                    );
                } else {
                    throw new Error('Quote Operation Failed');
                }
            }),
            finalize(() => {
                this.loadingService.hide();
                this.isSubmitting = false;
            })
        ).subscribe({
            next: (data: any) => {
                // Robustly find the Quote record and the SalesTransactionName
                const records = data.quote.instance?.records || [];
                const lineItems: any[] = [];
                
                // Support the transaction.SalesTransaction structure provided by the user
                const transactionRecord = data.quote.transaction?.SalesTransaction?.[0];
                const quoteRecord = records.find((r: any) => r.attributes?.type === 'Quote') || 
                                   transactionRecord || 
                                   (data.quote.instance?.records?.[0]) || 
                                   data.quote;
                
                const salesTransactionName = data.quote.SalesTransactionName || 
                                           data.quote.instance?.SalesTransactionName || 
                                           data.quote.quote?.SalesTransactionName ||
                                           transactionRecord?.SalesTransactionName ||
                                           quoteRecord?.SalesTransactionName;
                                           
                const formatted = salesTransactionName || quoteRecord?.Name || data.quote.quote?.Name || 'Q-';
                
                // The RLM API uses lowercase 'id'
                const resolvedQuoteId = quoteRecord?.id || quoteRecord?.Id || data.quoteId;
                
                // Merge existing products with new products if needed
                const currentProducts = quoteData.products || [];
                const newProductsMapped = cartItems.map((item: any) => {
                    const matchingLine = lineItems.find((li: any) => li.Product2Id === item.id);
                    return {
                        id: item.id,
                        name: item.name,
                        categoryId: item.categoryId,
                        quoteLineId: matchingLine ? matchingLine.Id : null
                    };
                });

                // Avoid duplicate products in the list
                const productMap = new Map();
                currentProducts.forEach((p: any) => productMap.set(p.id, p));
                newProductsMapped.forEach((p: any) => productMap.set(p.id, p));

                this.quoteDataService.setQuoteData({
                    quoteId: resolvedQuoteId,
                    quoteName: formatted,
                    products: Array.from(productMap.values())
                });

                if (newProductsMapped.length > 0) {
                    this.quoteDataService.setQuoteData({
                        productId: newProductsMapped[0].id,
                        productName: newProductsMapped[0].name,
                        categoryId: newProductsMapped[0].categoryId
                    });
                }

                this.searchFilterService.setSearchQuery('');
                this.cartService.clearCart();
                this.router.navigate(['/quote-configuration']);
            },
            error: (error: any) => {
                console.error('Quote operation error:', error);
            }
        });
    }
}
