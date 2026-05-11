import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SalesforceApiService } from '../../services/salesforce-api.service';
import { LoadingService } from '../../services/loading.service';
import { finalize, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { RcaApiService } from '../../services/rca-api.service';
import { QuoteDataService } from '../../services/quote-data.service';
import { CartService } from '../../services/cart.service';
import { DiscountIncentiveStateService } from '../../services/discount-incentive-state.service';

interface Opportunity {
    id: string;
    name: string;
    accountName: string;
    owner: string;
    amount: string;
    closeDate: string;
}

import { FormsModule } from '@angular/forms';
import { TopNavComponent } from '../../components/top-nav/top-nav.component';

import { TwAuthService } from '../../services/tw-auth.service';
import { ContextService } from '../../services/context.service';

@Component({
    selector: 'app-opportunities',
    standalone: true,
    imports: [CommonModule, TopNavComponent],
    templateUrl: './opportunities.component.html',
    styles: [`
        .dot-menu-container {
            position: relative;
            display: inline-block;
        }
        .dot-menu {
            position: absolute;
            right: 0;
            top: 100%;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 0.375rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            z-index: 50;
            min-width: 150px;
            padding: 0.5rem 0;
        }
        .dot-menu-item {
            display: flex;
            align-items: center;
            padding: 0.5rem 1rem;
            cursor: pointer;
            font-size: 0.875rem;
            color: #374151;
        }
        .dot-menu-item:hover {
            background-color: #f3f4f6;
        }
    `]
})
export class OpportunitiesComponent implements OnInit {
    private router = inject(Router);
    private sfApi = inject(SalesforceApiService);
    private loadingService = inject(LoadingService);
    private twAuth = inject(TwAuthService);
    private contextService = inject(ContextService);
    private rcaApi = inject(RcaApiService);
    private quoteService = inject(QuoteDataService);
    private cartService = inject(CartService);
    private discountStateService = inject(DiscountIncentiveStateService);
    protected Math = Math;

    opportunities: Opportunity[] = [];

    paginatedOpportunities: Opportunity[] = [];
    pageSize = 10;
    currentPage = 1;
    sortDirection: 'asc' | 'desc' = 'asc';
    activeMenuId: string | null = null;
    private rawDetailedRecords: any[] = [];

    ngOnInit(): void {
        this.fetchOpportunities();
    }


    private clearSessionData(): void {
        // Redundant as it is handled by AppComponent now
    }

    debugTokenStatus(): void {
        // Debug method removed
    }

    forceReLogin(): void {
        sessionStorage.clear();
        localStorage.clear();
        this.twAuth.login();
    }

    fetchOpportunities(): void {
        this.loadingService.show();
        this.sfApi.getOpportunities().pipe(
            finalize(() => this.loadingService.hide())
        ).subscribe({
            next: (response) => {
                const records = response.records || [];

                this.rawDetailedRecords = records;
                this.opportunities = records.map((record: any) => ({
                    id: record.Id,
                    name: record.Name,
                    accountName: record.Account?.Name || '-',
                    owner: record.Owner?.Name || '-',
                    amount: record.Amount != null ? `$${record.Amount.toLocaleString()}` : '-',
                    closeDate: record.CloseDate || '-'
                }));
                this.updatePagination();
            },
            error: (err) => {
                this.updatePagination();
            }
        });
    }

    createQuote(opp: any): void {
        this.loadingService.show();
        this.sfApi.getOpportunityDetails(opp.id).pipe(
            finalize(() => this.loadingService.hide())
        ).subscribe({
            next: (rawOpp: any) => {
                if (rawOpp) {
                    console.log('[Opportunities] Detailed Opportunity for Quote:', rawOpp);

                    // Extract Primary Contact from subquery
                    let contactName = null;
                    if (rawOpp.OpportunityContactRoles && rawOpp.OpportunityContactRoles.records && rawOpp.OpportunityContactRoles.records.length > 0) {
                        contactName = rawOpp.OpportunityContactRoles.records[0].Contact?.Name;
                    }

                    this.quoteService.setQuoteData({
                        opportunityId: rawOpp.Id,
                        opportunityName: rawOpp.Name,
                        accountId: rawOpp.AccountId,
                        accountName: rawOpp.Account?.Name,
                        website: rawOpp.Account?.Website,
                        pricebook2Id: rawOpp.Pricebook2Id,
                        primaryContactName: contactName,
                        salesChannel: rawOpp.Sales_Channel__c || 'Direct'
                    });

                    this.cartService.clearCart();
                    this.rcaApi.getProducts();
                    this.router.navigate(['/products'], {
                        queryParams: { opportunityId: rawOpp.Id }
                    });
                }
            },
            error: (err) => {
                console.error('Error fetching opportunity details:', err);
            }
        });
    }

    viewQuotes(opp: any): void {
        this.loadingService.show();
        this.sfApi.getOpportunityDetails(opp.id).pipe(
            finalize(() => this.loadingService.hide())
        ).subscribe({
            next: (rawOpp: any) => {
                if (rawOpp) {
                    console.log('[Opportunities] Detailed Opportunity for Quote:', rawOpp);

                    // Extract Primary Contact from subquery
                    let contactName = null;
                    if (rawOpp.OpportunityContactRoles && rawOpp.OpportunityContactRoles.records && rawOpp.OpportunityContactRoles.records.length > 0) {
                        contactName = rawOpp.OpportunityContactRoles.records[0].Contact?.Name;
                    }

                    this.quoteService.setQuoteData({
                        opportunityId: rawOpp.Id,
                        opportunityName: rawOpp.Name,
                        accountId: rawOpp.AccountId,
                        accountName: rawOpp.Account?.Name,
                        website: rawOpp.Account?.Website,
                        pricebook2Id: rawOpp.Pricebook2Id,
                        primaryContactName: contactName,
                        salesChannel: rawOpp.Sales_Channel__c || 'Direct'
                    });

                    this.router.navigate(['/quotes']);
                }
            },
            error: (err) => {
                console.error('Error fetching opportunity details:', err);
            }
        });
    }

    toggleSort(): void {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        this.sortOpportunities();
        this.currentPage = 1;
        this.updatePagination();
    }

    sortOpportunities(): void {
        this.opportunities.sort((a, b) => {
            const res = a.name.localeCompare(b.name);
            return this.sortDirection === 'asc' ? res : -res;
        });
    }

    updatePagination(): void {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        this.paginatedOpportunities = this.opportunities.slice(startIndex, endIndex);
    }

    onPageSizeChange(event: any): void {
        this.pageSize = +event.target.value;
        this.currentPage = 1;
        this.updatePagination();
    }

    nextPage(): void {
        if (this.currentPage * this.pageSize < this.opportunities.length) {
            this.currentPage++;
            this.updatePagination();
        }
    }

    prevPage(): void {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.updatePagination();
        }
    }

    firstPage(): void {
        this.currentPage = 1;
        this.updatePagination();
    }

    lastPage(): void {
        this.currentPage = Math.ceil(this.opportunities.length / this.pageSize);
        this.updatePagination();
    }

    toggleMenu(id: string, event: Event): void {
        event.stopPropagation();
        this.activeMenuId = this.activeMenuId === id ? null : id;
    }

    closeMenu(): void {
        this.activeMenuId = null;
    }


}
