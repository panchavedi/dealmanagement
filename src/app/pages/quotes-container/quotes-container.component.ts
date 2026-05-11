import { Component, OnInit, inject, Input } from '@angular/core';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { SalesforceApiService } from '../../services/salesforce-api.service';
import { LoadingService } from '../../services/loading.service';
import { finalize } from 'rxjs/operators';
import { RcaApiService } from '../../services/rca-api.service';
import { QuoteDataService } from '../../services/quote-data.service';
import { FormsModule } from '@angular/forms';
import { TwAuthService } from '../../services/tw-auth.service';
import { ContextService } from '../../services/context.service';
import { CommonModule, Location } from '@angular/common';
import { TopNavComponent } from '../../components/top-nav/top-nav.component';

interface Quote {
    id: string;
    number: string;
    name: string;
    account: string;
    primaryContact: string;
    status: string;
    primary: string;
    closeDate: string;
    createdBy: string;
}

@Component({
    selector: 'app-quotes-container',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TopNavComponent],
    templateUrl: './quotes-container.component.html',
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
export class QuotesContainerComponent implements OnInit {

    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private sfApi = inject(SalesforceApiService);
    private loadingService = inject(LoadingService);
    private twAuth = inject(TwAuthService);
    private quoteService = inject(QuoteDataService);
    private location = inject(Location);
    protected Math = Math;

    opportunityId: string = '';
    opportunityName: string = '';

    quotesCount: number = 0;

    paginatedQuotes: Quote[] = [];
    pageSize = 10;
    currentPage = 1;
    searchText: string = '';
    searchModeEnabled: boolean = false;
    sortDirection: 'ASC' | 'DESC' = 'ASC';
    activeMenuId: string | null = null;

    editPopup: boolean = false;
    detailsLoaded: boolean = false;
    selectedItem: any = null;
    isLoading: boolean = false;

    ngOnInit(): void {
        const data = this.quoteService.getQuoteData();

        this.opportunityId = data?.opportunityId || '';
        this.opportunityName = data?.opportunityName || 'Opportunity';

        if (!this.opportunityId) {
            return;
        }

        this.fetchQuotesInit(this.opportunityId);
    }

    debugTokenStatus(): void {
        // Debug method removed
    }

    forceReLogin(): void {
        sessionStorage.clear();
        localStorage.clear();
        this.twAuth.login();
    }

    fetchQuotesInit(oppId: string): void {
        this.loadingService.show()

        this.sfApi.getActiveQuotesCount(oppId).pipe(
            finalize(() => {
                this.loadingService.hide();
            })
        ).subscribe({
            next: (response) => {
                this.quotesCount = response?.totalSize || 0;
                if (this.quotesCount === 0) {
                    this.paginatedQuotes = [];
                    this.isLoading = false;
                    return;
                }
                this.fetchQuotes(this.pageSize, 0);
            },
            error: (err) => {
                console.error('Error fetching quotes count:', err);
                this.quotesCount = 0;
                this.isLoading = false;
            }
        });
    }

    fetchQuotes(limit: number, offset: number): void {
        this.isLoading = true;

        if (this.searchModeEnabled) {
            const term = this.searchText.trim().toLowerCase();
            this.sfApi.quotesSearch(this.opportunityId, this.searchText, this.sortDirection, limit, offset).pipe(
                finalize(() => {
                    this.isLoading = false;
                })
            ).subscribe({
                next: (response) => {
                    const records = response?.searchRecords || [];

                    if (records.length === 0) {
                        this.paginatedQuotes = [];
                        return;
                    }

                    this.paginatedQuotes = records.map((record: any) => ({
                        id: record.Id,
                        number: record.QuoteNumber,
                        name: record.Name,
                        account: record.Account?.Name || '-',
                        status: record.Status || '-',
                        primaryContact: record.Account?.briefingedge__Primary_Contact__c || '-',
                        primary: record.Primary ? 'Yes' : 'No',
                        closeDate: record.ExpirationDate || '-',
                        createdBy: record.CreatedBy?.Name || '-'
                    }));
                },
                error: (err) => {
                    console.error('Error fetching quotes:', err);
                    this.paginatedQuotes = [];
                    this.isLoading = false;
                }
            });
            return;
        }

        this.sfApi.getActiveQuotes(this.opportunityId, this.sortDirection, limit, offset).pipe(
            finalize(() => {
                this.isLoading = false;
                this.loadingService.hide();
            })
        ).subscribe({
            next: (response) => {
                const records = response?.records || [];

                if (records.length === 0) {
                    this.paginatedQuotes = [];
                    return;
                }

                this.paginatedQuotes = records.map((record: any) => ({
                    id: record.Id,
                    number: record.QuoteNumber,
                    name: record.Name,
                    account: record.Account?.Name || '-',
                    status: record.Status || '-',
                    primaryContact: record.Account?.briefingedge__Primary_Contact__c || '-',
                    primary: record.Primary ? 'Yes' : 'No',
                    closeDate: record.ExpirationDate || '-',
                    createdBy: record.CreatedBy?.Name || '-'
                }));
            },
            error: (err) => {
                console.error('Error fetching quotes:', err);
                this.paginatedQuotes = [];
            }
        });
    }

    searchQuotes() {
        this.searchText = this.searchText.trim().toLowerCase();
        if (!this.searchText) {
            this.searchModeEnabled = false;
        } else {
            this.searchModeEnabled = true;
        }
        this.currentPage = 1;
        this.fetchQuotes(this.pageSize, 0);
    }

    editQuote(quote: any, event: Event): void {
        event.stopPropagation();

        this.editPopup = true;
        this.selectedItem = { ...quote };

        this.quoteService.setQuoteData({
            quoteId: quote.id,
            quoteName: quote.name,
            primaryContactName: quote.primaryContact
        });

        this.router.navigate(['/quote-edit', quote.name]);
    }


    toggleSort(): void {
        if (this.quotesCount === 0) {
            return;
        }
        this.sortDirection = this.sortDirection === 'ASC' ? 'DESC' : 'ASC';
        this.currentPage = 1;
        this.fetchQuotes(this.pageSize, 0);
    }

    updatePagination(): void {
        this.fetchQuotes(this.pageSize, (this.currentPage - 1) * this.pageSize);
    }

    onPageSizeChange(event: any): void {
        this.pageSize = +event.target.value;
        this.currentPage = 1;
        this.updatePagination();
    }

    nextPage(): void {
        if (this.currentPage * this.pageSize < this.quotesCount) {
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
        if (this.quotesCount > 0) {
            this.currentPage = Math.ceil(this.quotesCount / this.pageSize);
            this.updatePagination();
        }
    }

    closeMenu(): void {
        this.activeMenuId = null;
    }

    cancelEdit(event?: Event) {
        event?.stopPropagation();

        this.editPopup = false;
        this.selectedItem = null;
    }

    saveChanges() {
        if (!this.selectedItem) return;

        const index = this.paginatedQuotes.findIndex(
            q => q.id === this.selectedItem.id
        );

        if (index !== -1) {
            this.paginatedQuotes[index] = { ...this.selectedItem };
            this.updatePagination();
        }

        this.cancelEdit();
    }

    goBack() {
        this.location.back();
    }

}
