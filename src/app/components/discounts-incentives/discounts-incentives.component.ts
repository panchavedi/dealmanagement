import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { RcaApiService } from '../../services/rca-api.service';
import { QuoteRefreshService } from '../../services/quote-refresh.service';
import { SalesforceApiService } from '../../services/salesforce-api.service';
import { ContextService } from '../../services/context.service';
import { ToastService } from '../../services/toast.service';
import { LoadingService } from '../../services/loading.service';
import { DiscountIncentiveStateService } from '../../services/discount-incentive-state.service';
import { QuoteDataService } from '../../services/quote-data.service';
import { finalize, forkJoin, map, catchError, of, switchMap, lastValueFrom, Subject, Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { UploadProductsModalComponent } from '../upload-products-modal/upload-products-modal.component';

@Component({
    selector: 'app-discounts-incentives',
    standalone: true,
    imports: [CommonModule, FormsModule, UploadProductsModalComponent],
    templateUrl: './discounts-incentives.component.html',
})
export class DiscountsIncentivesComponent implements OnChanges, OnDestroy {
    @Input() productId: string | null = null;
    @Input() parentQuoteLineId: string | null = null; // Parent Bundle Line ID
    @Input() categoryId: string | null = null;
    @Input() quoteStartDate: string | null = null;
    @Input() quoteEndDate: string | null = null;
    @Input() isLookerSubscription: boolean = false;
    @Input() quoteId: string | null = null;
    @Input() hasDiscountErrors: boolean = false;
    @Input() hasIncentiveErrors: boolean = false;
    @Input() discountErrorProductIds: string[] = [];
    @Input() incentiveErrorProductIds: string[] = [];
    @Output() discountErrorBlockClicked = new EventEmitter<void>();
    @Output() incentiveErrorBlockClicked = new EventEmitter<void>();
    @Input() set existingLineItems(items: any[]) {
        if (items && items.length > 0) {
            this.loadFromExisting(items);
        }
    }
    isLoading = false;

    // Tabs for the Right Panel
    activeTab: 'discounts' | 'incentives' = 'discounts';

    // Form Models
    discountForm = {
        granularity: 'Select',
        type: 'Flat rate (%)',
        priceReference: 'Select',
        value: '',
        selectedItemsCount: 0
    };

    incentiveForm = {
        type: 'Select',
        amount: '',
        currency: 'USD',
        selectedItemsCount: 0
    };

    // Dropdown Options
    granularityOptions = ['Select', 'Overall', 'Granular'];
    typeOptions = ['Flat rate (%)']; // Fixed as per requirement
    priceReferenceOptions = ['Select', 'Float', 'Fixed'];
    timePeriodOptions = ['Date range'];

    // UI State for custom dropdowns
    granularityOpen = false;
    typeOpen = false;
    priceRefOpen = false;
    incentiveTypeOpen = false;

    // Action menus state
    openActionMenuId: string | null = null;
    periodDropdownOpen = false;

    discountPeriods = [
        {
            id: '1',
            name: 'Discount Period 1',
            timePeriod: 'Date Range',
            startDate: '',
            endDate: '',
            activeDiscounts: [] as any[]
        }
    ];
    activeDiscountPeriodId = '1';

    incentivePeriods = [
        {
            id: '1',
            name: 'Incentives',
            timePeriod: 'Date Range',
            startDate: '',
            endDate: '',
            activeIncentives: [] as any[]
        }
    ];
    activeIncentivePeriodId = '1';

    get activeDiscountPeriod() {
        return this.discountPeriods.find(p => p.id === this.activeDiscountPeriodId);
    }

    get activeIncentivePeriod() {
        return this.incentivePeriods.find(p => p.id === this.activeIncentivePeriodId) || this.incentivePeriods[0];
    }

    addDiscountPeriod() {
        if (this.discountPeriods.length >= 2) return;

        const id = Date.now().toString();
        this.discountPeriods.push({
            id: id,
            name: `Discount Period ${this.discountPeriods.length + 1}`,
            timePeriod: 'Date range',
            startDate: '',
            endDate: '',
            activeDiscounts: []
        });
        this.activeDiscountPeriodId = id;
        this.saveCurrentState(); // Auto-save on period change
    }

    removeDiscountPeriod(id: string) {
        if (this.discountPeriods.length > 1) {
            this.discountPeriods = this.discountPeriods.filter(p => p.id !== id);
            if (this.activeDiscountPeriodId === id) {
                this.activeDiscountPeriodId = '';
            }
            this.discountPeriods.forEach((p, index) => p.name = `Discount Period ${index + 1}`);
            this.saveCurrentState(); // Auto-save on period change
        }
    }

    addIncentivePeriod() {
        const id = Date.now().toString();
        this.incentivePeriods.push({
            id: id,
            name: 'Incentives',
            timePeriod: 'Date range',
            startDate: '',
            endDate: '',
            activeIncentives: []
        });
        this.activeIncentivePeriodId = id;
        this.saveCurrentState(); // Auto-save on period change
    }

    removeIncentivePeriod(id: string) {
        if (this.incentivePeriods.length > 1) {
            this.incentivePeriods = this.incentivePeriods.filter(p => p.id !== id);
            if (this.activeIncentivePeriodId === id) {
                this.activeIncentivePeriodId = this.incentivePeriods[0].id;
            }
            this.incentivePeriods.forEach((p, index) => p.name = 'Incentives');
            this.saveCurrentState(); // Auto-save on period change
        }
    }

    // Product Quota Tracking
    @Input() remainingQuota: number = 1000;
    totalCatalogProducts: number = 1000;

    get usedQuotaCount(): number {
        return Math.max(0, this.totalCatalogProducts - this.remainingQuota);
    }

    get activeQuoteId(): string | undefined {
        return this.quoteId || this.contextService.currentContext?.quoteId || this.quoteDataService.getQuoteData()?.quoteId || undefined;
    }

    get activePricebookId(): string {
        return this.contextService.currentContext?.pricebookId || this.quoteDataService.getQuoteData()?.pricebook2Id || '01sf4000003ZgtzAAC';
    }

    // Live remaining = global quota (which already factors in current selections via the parent component)
    get liveQuotaRemaining(): number {
        return this.remainingQuota;
    }

    // Dropdown Options
    incentiveTypeOptions = ['Select', 'Incentives type 1', 'Incentives type 2'];



    // Product Selector Logic
    showProductSelector = false;
    showUploadModal = false;
    productTab: 'groups' | 'individual' = 'groups';
    filterQuery: string = '';
    viewMode: 'all' | 'selected' = 'all';
    // Which right-panel tab triggered the selector ('discounts' | 'incentives')
    selectorCalledFrom: 'discounts' | 'incentives' = 'discounts';

    // Persistent Selection State for Incentives (separate from discounts)
    persistentIncentiveGroups = new Map<string, any>();

    // Sorting
    sortConfig = {
        column: 'name',
        direction: 'asc' as 'asc' | 'desc'
    };

    // Data
    displayMode: 'grid' | 'list' = 'list';
    productGroups: any[] = [];
    individualProducts: any[] = [];

    // Persistent Selection State
    persistentSelectedGroups = new Map<string, any>();
    persistentSelectedIndividuals = new Map<string, any>();
    // Track Product2 IDs that were added via bulk CSV upload
    bulkUploadedProductIds = new Set<string>();
    // Flag to avoid refetching data on navigation back
    private dataFetched = false;

    // Snapshot for rollback on Cancel
    private snapshotSelectedGroups = new Map<string, any>();
    private snapshotSelectedIndividuals = new Map<string, any>();
    private snapshotIncentiveGroups = new Map<string, any>();

    private allClassifications: any[] = [];
    // Dropdown Data
    dropdownOptions: any[] = [];
    selectedDropdownOption: any = null;
    dropdownSearchText: string = '';

    // Individual Pagination State
    individualPageSize: number = 100;
    individualPageOptions: number[] = [10, 20, 50, 100];
    individualCurrentOffset: number = 0;
    individualTotalLoaded: number = 0;
    isIndividualLoading: boolean = false;
    productSearchTerm: string = '';
    private currentProductReq: any;
    rootClassificationId: string = '11BDz00000000NvMAI'; // ID for fetching sibling bundles (e.g., NvMAI)
    bundleCategoryId: string | null = null;
    bundleSearchTerm: string = '';

    // Cursor Pagination State
    nextPageCursor: string | null = null;
    cursorStack: string[] = ['']; // Stack of cursors for forward/backward navigation
    currentCursorIndex: number = 0;


    // Picklist Filter State (Region + Billing Frequency dropdowns)
    picklistLoaded = false;
    isPicklistLoading = false;
    regionOptions: { label: string; value: string }[] = [];
    billingFreqOptions: { label: string; value: string }[] = [];

    selectedRegion: { label: string; value: string } | null = null;
    selectedBillingFreq: { label: string; value: string } | null = null;

    regionDropdownOpen = false;
    billingDropdownOpen = false;
    regionSearchText = '';
    billingSearchText = '';

    get filteredRegionOptions() {
        if (!this.regionOptions) return [];
        const q = (this.regionSearchText || '').toLowerCase();
        return this.regionOptions.filter(o => (o.label || '').toLowerCase().includes(q));
    }

    get filteredBillingOptions() {
        if (!this.billingFreqOptions) return [];
        const q = (this.billingSearchText || '').toLowerCase();
        return this.billingFreqOptions.filter(o => (o.label || '').toLowerCase().includes(q));
    }

    // Kept for backward compat with evaluateSearchAndBuildCriteria references
    get facetedFilterData() {
        return {
            regions: this.regionOptions.map(o => ({ ...o, selected: this.selectedRegion?.value === o.value })),
            billingFrequencies: this.billingFreqOptions.map(o => ({ ...o, selected: this.selectedBillingFreq?.value === o.value }))
        };
    }

    constructor(
        private rcaApiService: RcaApiService,
        private salesforceApiService: SalesforceApiService,
        private contextService: ContextService,
        private toastService: ToastService,
        private loadingService: LoadingService,
        private quoteRefreshService: QuoteRefreshService,
        private discountIncentiveStateService: DiscountIncentiveStateService,
        private quoteDataService: QuoteDataService,
        private el: ElementRef,
        private router: Router
    ) {
        // As requested: dynamically take categoryIds from RcaApiService.getProducts response
        // Matching against the current productId to ensure we get the correct bundle category
        this.rcaApiService.products$.subscribe(products => {
            if (products && products.length > 0) {
                const bundle = this.productId ? products.find(p => p.id === this.productId) : products[0];
                if (bundle && bundle.categories && bundle.categories.length > 0) {
                    this.bundleCategoryId = bundle.categories[0].id;
                    console.log('✅ [Discounts Incentives] Captured category ID from discovery page:', this.bundleCategoryId);
                }
            }
        });
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent) {
        // Since we stop propagation on all dropdown triggers and containers,
        // any click that reaches the document should close all open dropdowns.
        this.closeAllDropdowns();
    }

    closeAllDropdowns() {
        this.periodDropdownOpen = false;
        this.granularityOpen = false;
        this.typeOpen = false;
        this.priceRefOpen = false;
        this.incentiveTypeOpen = false;
        this.regionDropdownOpen = false;
        this.billingDropdownOpen = false;
        this.openActionMenuId = null;
    }

    ngOnInit() {
        // Load persisted state when component initializes
        this.loadPersistedState();
    }

    ngOnDestroy() {
        // Save current state when component is destroyed (navigation away)
        this.saveCurrentState();
    }

    private loadPersistedState() {
        // Load persisted state (now survives page refresh via sessionStorage)
        const quoteId = this.activeQuoteId;
        const state = this.discountIncentiveStateService.loadState(quoteId);

        // Only restore if state has meaningful data (not just defaults)
        const hasData = state.discountPeriods.some(p => p.startDate || p.endDate || p.activeDiscounts.length > 0) ||
            state.incentivePeriods.some(p => p.startDate || p.endDate || p.activeIncentives.length > 0) ||
            state.discountForm.granularity !== 'Select' ||
            state.incentiveForm.type !== 'Select';

        if (hasData) {
            console.log('📋 Restoring discount/incentive state from session');

            // Restore form data
            this.discountForm = { ...state.discountForm };
            this.incentiveForm = { ...state.incentiveForm };

            // Restore periods
            this.discountPeriods = [...state.discountPeriods];
            this.incentivePeriods = [...state.incentivePeriods];
            this.activeDiscountPeriodId = state.activeDiscountPeriodId;
            this.activeIncentivePeriodId = state.activeIncentivePeriodId;

            // Restore active tab
            this.activeTab = state.activeTab;

            // Restore selection state
            this.persistentSelectedGroups = new Map(state.persistentSelectedGroups);
            this.persistentSelectedIndividuals = new Map(state.persistentSelectedIndividuals);
            this.persistentIncentiveGroups = new Map(state.persistentIncentiveGroups);
            this.bulkUploadedProductIds = new Set(state.bulkUploadedProductIds || []);

            // Restore product data if available
            if (state.productGroups.length > 0) {
                this.productGroups = [...state.productGroups];
                this.dataFetched = true;
            }
            if (state.individualProducts.length > 0) {
                this.individualProducts = [...state.individualProducts];
            }
            if (state.dropdownOptions.length > 0) {
                this.dropdownOptions = [...state.dropdownOptions];
            }
            if (state.selectedDropdownOption) {
                this.selectedDropdownOption = state.selectedDropdownOption;
            }
        }
    }

    saveCurrentState() {
        const quoteId = this.activeQuoteId;
        this.discountIncentiveStateService.saveState({
            discountForm: this.discountForm,
            incentiveForm: this.incentiveForm,
            discountPeriods: this.discountPeriods,
            incentivePeriods: this.incentivePeriods,
            activeDiscountPeriodId: this.activeDiscountPeriodId,
            activeIncentivePeriodId: this.activeIncentivePeriodId,
            activeTab: this.activeTab,
            persistentSelectedGroups: this.persistentSelectedGroups,
            persistentSelectedIndividuals: this.persistentSelectedIndividuals,
            persistentIncentiveGroups: this.persistentIncentiveGroups,
            bulkUploadedProductIds: this.bulkUploadedProductIds,
            productGroups: this.productGroups,
            individualProducts: this.individualProducts,
            dropdownOptions: this.dropdownOptions,
            selectedDropdownOption: this.selectedDropdownOption
        }, quoteId);
    }

    resolveProductDisplayName(productId: string): string {
        if (!productId) return '';

        const sources = [
            ...Array.from(this.persistentSelectedGroups.values()),
            ...Array.from(this.persistentSelectedIndividuals.values()),
            ...Array.from(this.persistentIncentiveGroups.values()),
            ...this.productGroups,
            ...this.individualProducts,
            ...this.dropdownOptions
        ];

        const match = sources.find((item: any) =>
            item?.id === productId ||
            item?.Id === productId ||
            item?.productId === productId
        );

        return match?.name || match?.Name || match?.ProductName || '';
    }

    hasDiscountItemErrors(item: any): boolean {
        return this.hasItemErrors(item, this.discountErrorProductIds);
    }

    hasIncentiveItemErrors(item: any): boolean {
        return this.hasItemErrors(item, this.incentiveErrorProductIds);
    }

    private hasItemErrors(item: any, errorProductIds: string[]): boolean {
        if (!errorProductIds?.length) return false;
        const productIds = item?.productIds || [];
        if (productIds.length === 0) return false;
        return productIds.some((id: string) => errorProductIds.includes(id));
    }

    ngOnChanges(changes: any) {
        if (changes['productId'] && changes['productId'].currentValue && changes['productId'].currentValue !== changes['productId'].previousValue) {
            this.dataFetched = false; // Reset if product ID actually changes
            this._existingLinesLoaded = false;
            this.resetAllState();
        }
    }

    private _existingLinesLoaded = false;

    private loadFromExisting(items: any[]) {
        if (this._existingLinesLoaded || !items) return;

        const incentives = items.filter(i => (Number(i.Incentive__c) || 0) > 0);
        if (incentives.length === 0) return;

        // Group by StartDate and EndDate
        const groups = new Map<string, any[]>();
        incentives.forEach(item => {
            const key = `${item.StartDate}_${item.EndDate}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(item);
        });

        if (groups.size === 0) return;

        // Initialize incentivePeriods
        this.incentivePeriods = [];
        let pIndex = 1;
        groups.forEach((groupItems, key) => {
            const [startDate, endDate] = key.split('_');
            const totalAmount = groupItems.reduce((sum, item) => sum + (Number(item.Incentive__c) || 0), 0);

            const period = {
                id: (pIndex++).toString(),
                name: 'Incentives',
                timePeriod: 'Date range',
                startDate: startDate || '',
                endDate: endDate || '',
                activeIncentives: [{
                    id: 'existing_' + pIndex,
                    title: 'Existing Incentives',
                    subtext: `${groupItems.length} item${groupItems.length !== 1 ? 's' : ''}`,
                    value: groupItems.length === 1 ? `$${groupItems[0].Incentive__c}` : `$${totalAmount.toFixed(2)} (Total)`,
                    type: 'incentive',
                    responseTime: 'Loaded'
                }]
            };
            this.incentivePeriods.push(period);
        });

        if (this.incentivePeriods.length > 0) {
            this.activeIncentivePeriodId = this.incentivePeriods[0].id;
        }

        this._existingLinesLoaded = true;
    }

    resetAllState() {
        this.discountPeriods = [
            { id: '1', name: 'Discount Period 1', timePeriod: 'Date range', startDate: '', endDate: '', activeDiscounts: [] }
        ];
        this.activeDiscountPeriodId = '1';
        this.incentivePeriods = [
            { id: '1', name: 'Incentives', timePeriod: 'Date range', startDate: '', endDate: '', activeIncentives: [] }
        ];
        this.activeIncentivePeriodId = '1';
        this.activeTab = 'discounts';
    }

    fetchDropdownOptions() {
        if (!this.productId) return;
        if (this.dataFetched) return;

        this.rcaApiService.getDropdownOptions(this.rootClassificationId).subscribe({
            next: (res: any) => {
                const results = res.result || [];
                // Map CPQ results to the expected UI model
                this.dropdownOptions = results.map((p: any) => ({
                    Id: p.id,
                    Name: p.name,
                    pricebookEntryId: p.prices?.[0]?.priceBookEntryId || '',
                    price: p.prices?.[0]?.price || 0,
                    sortOrder: p.additionalFields?.RCA_Sort_order__c
                }));

                // Select the first option by default if available
                if (this.dropdownOptions.length > 0) {
                    this.selectDropdownOption(this.dropdownOptions[0]);
                }
                this.dataFetched = true;
            },
            error: (err) => {
                console.error('Error fetching dropdown options', err);
                this.toastService.show('Error fetching product classifications', 'error');
            }
        });
    }


    /**
     * Getter for the filtered and sorted list of groups.
     * This ensures the UI updates instantly when the search text changes or when a product is selected.
     */
    get displayDropdownOptions(): any[] {
        let options = [...this.dropdownOptions];

        // 1. Filter by search text
        if (this.dropdownSearchText) {
            const term = this.dropdownSearchText.toLowerCase();
            options = options.filter(opt => opt.Name && opt.Name.toLowerCase().includes(term));
        }

        // 2. Pre-calculate selected counts to optimize sort performance
        const familyCounts = new Map<string, number>();
        this.persistentSelectedIndividuals.forEach((item) => {
            if (item.family) {
                familyCounts.set(item.family, (familyCounts.get(item.family) || 0) + 1);
            }
        });

        // 3. Sort logic:
        // - Groups with selections move to the front.
        // - Then sorted by count (higher first).
        // - Then sorted alphabetically.
        options.sort((a, b) => {
            const countA = familyCounts.get(a.Name) || 0;
            const countB = familyCounts.get(b.Name) || 0;

            if (countA > 0 && countB === 0) return -1;
            if (countB > 0 && countA === 0) return 1;
            if (countA > countB) return -1;
            if (countB > countA) return 1;

            return (a.Name || '').localeCompare(b.Name || '');
        });

        return options;
    }

    /**
     * Returns the number of selected products belonging to a specific classification.
     */
    getSelectedCountForClassification(classificationName: string): number {
        let count = 0;
        this.persistentSelectedIndividuals.forEach((item) => {
            if (item.family === classificationName) count++;
        });
        return count;
    }

    selectDropdownOption(option: any) {
        this.selectedDropdownOption = option;

        // As requested: clear existing filters when selecting a new classification
        this.selectedRegion = null;
        this.selectedBillingFreq = null;
        this.regionSearchText = '';
        this.billingSearchText = '';

        // Reset Cursor Pagination for the new classification selection
        this.cursorStack = [''];
        this.currentCursorIndex = 0;
        this.nextPageCursor = null;

        this.individualCurrentOffset = 0; // Reset pagination offset on new selection

        // We should also reset the search term if a classification is selected
        this.productSearchTerm = '';

        this.loadIndividualProducts();
    }

    // When Region or Billing Frequency filters are applied, use the PCM faceted filter API
    applyFilters() {
        // Reset offset (though we now prefer cursors)
        this.individualCurrentOffset = 0;

        const criteria = this.getFilterCriteria();

        // If we have active Region/Billing filters, use the faceted filter API
        if (criteria.length > 0) {
            this.executeFacetedFilter();
        } else {
            // No filters active, reload default products for category
            this.loadIndividualProducts();
        }
    }

    setActiveTab(tab: 'discounts' | 'incentives') {
        this.activeTab = tab;
        this.periodDropdownOpen = false;
        this.viewMode = 'all'; // Reset view mode when switching tabs
        
        // Reset selections and forms when switching tabs to satisfy "fresh tab" requirement
        this.resetSelections();
        this.persistentIncentiveGroups.clear();
        this.incentiveForm.amount = '';
        this.incentiveForm.type = 'Select';
        this.discountForm.granularity = 'Select';
        this.discountForm.priceReference = 'Select';

        this.saveCurrentState(); // Auto-save on tab change
    }

    // Dropdown Handlers with auto-save
    selectGranularity(option: string) {
        this.discountForm.granularity = option;
        this.granularityOpen = false;
        this.saveCurrentState(); // Auto-save on change
    }

    selectType(option: string) {
        this.discountForm.type = option;
        this.typeOpen = false;
        this.saveCurrentState(); // Auto-save on change
    }

    selectPriceRef(option: string) {
        this.discountForm.priceReference = option;
        this.priceRefOpen = false;
        this.saveCurrentState(); // Auto-save on change
    }

    selectIncentiveType(option: string) {
        this.incentiveForm.type = option;
        this.incentiveTypeOpen = false;
        this.saveCurrentState(); // Auto-save on change
    }

    minDate: string = new Date().toLocaleDateString('en-CA');

    validateDiscountDates(period: any) {
        if (!period.startDate || !period.endDate) return;

        if (period.endDate < period.startDate) {
            this.toastService.show('Discount End Date cannot be earlier than Start Date.', 'warning');
            period.endDate = '';
        }

        if (this.quoteStartDate && period.startDate < this.quoteStartDate) {
            this.toastService.show(`Start Date cannot be earlier than quote start date (${this.quoteStartDate}).`, 'warning');
            period.startDate = this.quoteStartDate;
        }

        if (this.quoteEndDate && period.endDate > this.quoteEndDate) {
            this.toastService.show(`End Date cannot be later than quote end date (${this.quoteEndDate}).`, 'warning');
            period.endDate = this.quoteEndDate;
        }

        this.saveCurrentState();
    }

    validateIncentiveDates(period: any) {
        if (!period.startDate || !period.endDate) return;

        if (period.endDate < period.startDate) {
            this.toastService.show('Incentives End Date cannot be earlier than Start Date.', 'warning');
            period.endDate = '';
        }

        if (this.quoteStartDate && period.startDate < this.quoteStartDate) {
            this.toastService.show(`Start Date cannot be earlier than quote start date (${this.quoteStartDate}).`, 'warning');
            period.startDate = this.quoteStartDate;
        }

        if (this.quoteEndDate && period.endDate > this.quoteEndDate) {
            this.toastService.show(`End Date cannot be later than quote end date (${this.quoteEndDate}).`, 'warning');
            period.endDate = this.quoteEndDate;
        }

        this.saveCurrentState();
    }
    // Selector Actions
    openProductSelector(source: 'discounts' | 'incentives' = 'discounts') {
        this.selectorCalledFrom = source;

        // Fetch Region/Billing filters only for the Discounts flow (Period 1/2) as requested
        if (source === 'discounts') {
            this.loadPicklistOptions();
        }

        // Date Validation: Ensure start and end dates are selected for the active period
        const currentPeriod = source === 'discounts' ? this.activeDiscountPeriod : this.activeIncentivePeriod;
        if (!currentPeriod || !currentPeriod.startDate || !currentPeriod.endDate) {
            const periodLabel = source === 'discounts' ? 'Discount' : 'Incentives';
            this.toastService.show(`Please select both Start and End dates for the ${periodLabel} Period first.`, 'warning');
            return;
        }

        // For discounts, validate granularity/type first
        if (source === 'discounts') {
            if (this.discountForm.granularity === 'Select' || this.discountForm.type === 'Select') {
                this.toastService.show('Please select a Discount Type.', 'warning');
                return;
            }
        }

        // Take snapshots for rollback on Cancel
        this.snapshotSelectedGroups = new Map(this.persistentSelectedGroups);
        this.snapshotSelectedIndividuals = new Map(this.persistentSelectedIndividuals);
        this.snapshotIncentiveGroups = new Map(this.persistentIncentiveGroups);

        this.showProductSelector = true;
        // Always reset view mode to 'all' for a fresh start as requested
        this.viewMode = 'all'; 
        // Always start on Product Groups tab
        this.productTab = 'groups';
        // Redundant call removed - picklists only needed for individual tab if subscription
        if (this.productId) {
            // Always re-fetch if productGroups is empty OR coming from incentives and not yet loaded
            if (!this.dataFetched || this.productGroups.length === 0) {
                this.dataFetched = false;
                this.fetchProductDetails();
            } else {
                // If already fetched, just sync the selection state for the current tab
                this.syncSelectionState();
            }
        } else {
            this.productGroups = [];
            this.individualProducts = [];
        }
    }

    syncSelectionState() {
        if (this.selectorCalledFrom === 'incentives') {
            // Incentives track group selections in this modal
            this.productGroups.forEach(g => {
                const saved = this.persistentIncentiveGroups.get(g.id);
                if (saved) {
                    g.selected = true;
                    // Restore the amount entered by the user
                    g.incentiveAmount = saved.incentiveAmount || 0;
                    // Update map with fresh reference to the current object in the list
                    this.persistentIncentiveGroups.set(g.id, g);
                } else {
                    g.selected = false;
                    g.incentiveAmount = 0;
                }
            });
            this.individualProducts.forEach(p => {
                p.selected = false;
                p.incentiveAmount = 0;
            });
        } else {
            // Discounts track both
            this.productGroups.forEach(g => {
                const saved = this.persistentSelectedGroups.get(g.id);
                if (saved) {
                    g.selected = true;
                    g.discount = saved.discount;
                    this.persistentSelectedGroups.set(g.id, g);
                } else {
                    g.selected = false;
                    g.discount = 0;
                }
            });
            this.individualProducts.forEach(p => {
                const saved = this.persistentSelectedIndividuals.get(p.id);
                if (saved) {
                    p.selected = true;
                    p.discount = saved.discount;
                    this.persistentSelectedIndividuals.set(p.id, p);
                } else {
                    p.selected = false;
                    p.discount = 0;
                }
            });
        }
    }

    // Upload Modal Actions
    openUploadModal() {
        console.log("Clicked upload products")
        this.showUploadModal = true;
    }

    closeUploadModal() {
        this.showUploadModal = false;
    }

    debugData: any = null;

    fetchProductDetails() {
        if (!this.productId) return;

        this.isLoading = true;
        this.debugData = null;

        // 1. Get Classifications for the bundle
        console.log('📊 [fetchProductDetails] Call 1: Fetching classifications for productId:', this.productId);
        this.rcaApiService.getProductClassifications(this.productId).subscribe({
            next: (res: any) => {
                const records = res.records || [];
                console.log('✅ [fetchProductDetails] Classifications response:', records);

                // Store all classifications for mapping bubbles
                this.allClassifications = records;

                // 1. Get Classifications for the bundle (Groups Tab) - only those without child bundles
                const classifications = records.filter((r: any) => r.It_has_Bundle_Products__c === false);
                this.mapNewProductData(classifications);

                // Find root classification ID where It_has_Bundle_Products__c is true
                const rootClass = records.find((r: any) => r.It_has_Bundle_Products__c === true);
                if (rootClass) {
                    this.rootClassificationId = rootClass.Id;
                    console.log('✅ [fetchProductDetails] Root Classification ID found:', this.rootClassificationId);

                    // 2. Get the "Computed" bundles (sidebar categories) using CPQ Products API
                    console.log('📊 [fetchProductDetails] Call 2: Fetching categories using rootClassificationId:', this.rootClassificationId);
                    this.rcaApiService.getDropdownOptions(this.rootClassificationId).pipe(
                        finalize(() => {
                            this.isLoading = false;
                            this.dataFetched = true;
                        })
                    ).subscribe({
                        next: (cpqRes: any) => {
                            const results = cpqRes.result || [];
                            console.log('✅ [fetchProductDetails] Categories response:', results);

                            this.dropdownOptions = results.map((p: any) => {
                                // Find matching classification from Call 1 (Case Insensitive)
                                const match = this.allClassifications.find(c => (c.Name || '').toLowerCase() === (p.name || '').toLowerCase());

                                // Enrich the matching product group in Tab 1 with price data
                                if (match) {
                                    const groupInTab = this.productGroups.find(g => g.id === match.Id);
                                    if (groupInTab) {
                                        groupInTab.productId = p.id;
                                        groupInTab.pricebookEntryId = p.prices?.[0]?.priceBookEntryId || '';
                                        groupInTab.price = p.prices?.[0]?.price || 0;
                                        groupInTab.sortOrder = p.additionalFields?.RCA_Sort_order__c;
                                    }
                                }

                                return {
                                    Id: p.id,
                                    Name: p.name,
                                    pricebookEntryId: p.prices?.[0]?.priceBookEntryId || '',
                                    price: p.prices?.[0]?.price || 0,
                                    sortOrder: p.additionalFields?.RCA_Sort_order__c,
                                    classificationId: match ? match.Id : (p.productClassification?.id || p.id)
                                };
                            });

                            // Select the first category by default
                            if (this.dropdownOptions.length > 0) {
                                this.selectDropdownOption(this.dropdownOptions[0]);
                            }
                        },
                        error: (err) => {
                            console.error('❌ Error in CPQ categories fetch', err);
                            this.toastService.show('Failed to load categories', 'error');
                        }
                    });
                } else {
                    console.warn('⚠️ No root classification (It_has_Bundle_Products__c = true) found.');
                    this.isLoading = false;
                    this.dataFetched = true;
                }
            },
            error: (err) => {
                console.error('❌ Error fetching classifications', err);
                this.isLoading = false;
                this.toastService.show('Failed to load product classifications', 'error');
            }
        });
    }

    loadIndividualProducts() {
        if (!this.selectedDropdownOption) return;

        // 3. Get actual individual products for the selected category
        const targetClassId = this.selectedDropdownOption.classificationId || this.selectedDropdownOption.Id;
        console.log('🔍 [loadIndividualProducts] Using targetClassId:', targetClassId, 'for category:', this.selectedDropdownOption.Name);

        // Get the cursor for the current page from the stack if available
        const currentCursor = this.cursorStack[this.currentCursorIndex];

        // Construct the body – using cursor if available (Omit if null or empty)
        const body: any = {
            "limit": this.individualPageSize,
            "productClassificationId": targetClassId,
            "priceBookId": this.activePricebookId,
            "additionalFields": {
                "Product2": {
                    "fields": ["RCA_Sort_order__c"]
                }
            }
        };

        if (currentCursor && currentCursor.trim() !== "") {
            body.cursor = currentCursor;
        } else {
            // Only add offset if cursor is not present
            body.offset = this.individualCurrentOffset;
        }

        console.log(`📊 [loadIndividualProducts] Page: ${this.currentCursorIndex + 1}, Cursor: "${currentCursor || ''}" CPQ API Body:`, body);

        if (this.currentProductReq) {
            this.currentProductReq.unsubscribe();
        }

        this.isIndividualLoading = true;
        this.currentProductReq = this.rcaApiService.getCpqProducts(body, this.individualPageSize, this.individualCurrentOffset).pipe(
            finalize(() => this.isIndividualLoading = false)
        ).subscribe({
            next: (data) => {
                // Update nextPageCursor from API response
                this.nextPageCursor = data.cursor || null;

                // Handle various response formats (result, products, items, or direct array)
                const newProducts = data.result || data.products || data.items || (Array.isArray(data) ? data : []);
                this.individualTotalCount = data.totalCount || data.totalSize || (Array.isArray(newProducts) ? newProducts.length : 0);

                console.log(`✅ [loadIndividualProducts] Fetched ${newProducts.length} products. Next Cursor: ${this.nextPageCursor || 'None'}`);

                // Map to UI model
                const mappedProducts = newProducts.map((p: any) => {
                    // Use productId from selling model options if available
                    const resolvedId = p.productSellingModelOptions?.[0]?.productId || p.id;

                    // Find default price or fallback
                    const defaultPrice = p.prices?.find((pr: any) => pr.isDefault) || p.prices?.[0];

                    return {
                        id: resolvedId,
                        name: p.name,
                        family: this.selectedDropdownOption.Name, // Use classification name as family
                        selected: false,
                        discount: 0,
                        quantity: 1,
                        price: defaultPrice?.price || p.unitPrice || 0,
                        pricebookEntryId: defaultPrice?.priceBookEntryId || p.pricebookEntryId || '',
                        isBundleChild: false,
                        // Access sort order from multiple possible locations
                        sortOrder: p.additionalFields?.RCA_Sort_order__c ||
                            p.fields?.RCA_Sort_order__c ||
                            p.additionalFields?.Product2?.RCA_Sort_order__c ||
                            p.additionalFields?.Product2?.fields?.RCA_Sort_order__c
                    };
                });

                // Restore persistent selection state
                mappedProducts.forEach((p: any) => {
                    if (this.persistentSelectedIndividuals.has(p.id)) {
                        p.selected = true;
                        const saved = this.persistentSelectedIndividuals.get(p.id);
                        p.discount = saved.discount;
                        p.quantity = saved.quantity;
                        this.persistentSelectedIndividuals.set(p.id, p);
                    }
                });

                // Sort by RCA_Sort_order__c if available
                mappedProducts.sort((a: any, b: any) => {
                    const sortA = Number(a.sortOrder) || 0;
                    const sortB = Number(b.sortOrder) || 0;
                    return sortA - sortB;
                });

                this.individualProducts = mappedProducts;
            },
            error: (err) => {
                console.error('Error loading individual products', err);
                this.toastService.show('Error loading products', 'error');
            }
        });
    }

    handlePageSizeChange(newSize: number) {
        this.individualPageSize = Number(newSize);
        this.individualCurrentOffset = 0;

        if (this.productSearchTerm) {
            // Reset Cursor Pagination for the new page size
            this.cursorStack = [''];
            this.currentCursorIndex = 0;
            this.nextPageCursor = null;
            this.executeSearch();
        } else {
            this.loadIndividualProducts();
        }
    }

    individualTotalCount: number = 0;

    nextPage() {
        console.log('➡️ [Pagination] Moving forward');

        // Common cursor logic for Global Search, Classification search, and Faceted filters
        if (this.nextPageCursor && this.currentCursorIndex === this.cursorStack.length - 1) {
            // We have a new cursor and we are at the end of the stack
            this.cursorStack.push(this.nextPageCursor);
        }

        if (this.currentCursorIndex < this.cursorStack.length - 1) {
            this.currentCursorIndex++;

            if (this.productSearchTerm) {
                this.executeSearch();
            } else {
                // Update offset just in case some logic still relies on it
                this.individualCurrentOffset += Number(this.individualPageSize);

                // Choose between faceted filter and classification search
                const criteria = this.getFilterCriteria();
                if (criteria.length > 0) {
                    this.executeFacetedFilter();
                } else {
                    this.loadIndividualProducts();
                }
            }
        } else {
            console.warn('⚠️ No more pages available (no nextPageCursor)');
        }
    }

    prevPage() {
        console.log('⬅️ [Pagination] Moving backward');

        if (this.currentCursorIndex > 0) {
            this.currentCursorIndex--;

            if (this.productSearchTerm) {
                this.executeSearch();
            } else {
                // Move offset backward
                const pageSize = Number(this.individualPageSize);
                if (this.individualCurrentOffset >= pageSize) {
                    this.individualCurrentOffset -= pageSize;
                }

                // Choose between faceted filter and classification search
                const criteria = this.getFilterCriteria();
                if (criteria.length > 0) {
                    this.executeFacetedFilter();
                } else {
                    this.loadIndividualProducts();
                }
            }
        } else {
            // Traditional offset-based paging fallback
            if (!this.productSearchTerm) {
                const pageSize = Number(this.individualPageSize);
                if (this.individualCurrentOffset >= pageSize) {
                    this.individualCurrentOffset -= pageSize;

                    const criteria = this.getFilterCriteria();
                    if (criteria.length > 0) {
                        this.executeFacetedFilter();
                    } else {
                        this.loadIndividualProducts();
                    }
                }
            }
        }
    }

    onProductSearch() {
        console.log('[onProductSearch] Triggered with term:', this.productSearchTerm);

        // Reset view mode to 'all' to ensure search results are visible
        this.viewMode = 'all';
        this.filterQuery = '';

        // If search term is empty, reload default products for current category
        if (!this.productSearchTerm) {
            console.log('[onProductSearch] No search term, reloading default products');
            this.loadIndividualProducts();
            return;
        }

        // As requested: clear existing filters when performing a global search
        this.selectedRegion = null;
        this.selectedBillingFreq = null;
        this.regionSearchText = '';
        this.billingSearchText = '';

        // Reset Cursor Pagination for new search
        this.cursorStack = [''];
        this.currentCursorIndex = 0;
        this.nextPageCursor = null;

        this.individualCurrentOffset = 0; // Reset pagination offset on new search
        this.executeSearch();
    }

    // Builds criteria for Region/Billing Frequency filters ONLY (for faceted PCM filter API)
    private getFilterCriteria(): any[] {
        const criteria: any[] = [];

        if (this.selectedRegion) {
            criteria.push({
                "property": "RCA_Region__c",
                "operator": "eq",
                "value": this.selectedRegion.value
            });
        }

        if (this.selectedBillingFreq) {
            criteria.push({
                "property": "RCA_Billing_Frequency__c",
                "operator": "eq",
                "value": this.selectedBillingFreq.value
            });
        }

        return criteria;
    }

    // Builds criteria for global search API (includes isActive/Type defaults)
    private getSearchCriteria(): any[] {
        const criteria: any[] = [
            {
                "property": "isActive",
                "operator": "eq",
                "value": true
            },
            {
                "property": "Type",
                "operator": "eq",
                "value": ""
            }
        ];
        return criteria;
    }

    // Executes Region/Billing faceted filter using PCM API with classificationId in URL
    executeFacetedFilter() {
        if (this.currentProductReq) {
            this.currentProductReq.unsubscribe();
        }

        const criteria = this.getFilterCriteria();
        if (criteria.length === 0) {
            this.loadIndividualProducts();
            return;
        }

        // Use the classification ID of the selected group (dropdown option)
        const classificationId = this.selectedDropdownOption?.classificationId
            || this.selectedDropdownOption?.Id
            || this.categoryId;

        if (!classificationId) {
            console.warn('[executeFacetedFilter] No classification ID available for faceted filter.');
            this.toastService.show('Please select a product group first.', 'warning');
            return;
        }

        this.isIndividualLoading = true;

        // Get the cursor for the current page from the stack if available
        const currentCursor = this.cursorStack[this.currentCursorIndex];

        console.log('[executeFacetedFilter] Using classificationId:', classificationId, 'Page:', this.currentCursorIndex + 1, 'Cursor:', currentCursor || 'initial');

        this.currentProductReq = this.rcaApiService.facetedProductSearch(
            classificationId,
            criteria,
            Number(this.individualPageSize) || 100,
            Number(this.individualCurrentOffset) || 0,
            currentCursor
        ).pipe(
            finalize(() => this.isIndividualLoading = false)
        ).subscribe({
            next: (data) => {
                // Update nextPageCursor from API response
                this.nextPageCursor = data.cursor || null;

                const newProducts = data.result || data.products || data.items || [];
                this.individualTotalCount = data.totalCount || data.totalSize || (Array.isArray(newProducts) ? newProducts.length : 0);

                console.log(`✅ [executeFacetedFilter] Fetched ${newProducts.length} products. Next Cursor: ${this.nextPageCursor || 'None'}`);

                // Map to UI model
                const mappedProducts = newProducts.map((p: any) => {
                    const resolvedId = p.productSellingModelOptions?.[0]?.productId || p.id;
                    const defaultPrice = p.prices?.find((pr: any) => pr.isDefault) || p.prices?.[0];

                    return {
                        id: resolvedId,
                        name: p.name,
                        family: this.selectedDropdownOption?.Name || 'Filtered',
                        selected: false,
                        discount: 0,
                        quantity: 1,
                        price: defaultPrice?.price || p.unitPrice || 0,
                        pricebookEntryId: defaultPrice?.priceBookEntryId || p.pricebookEntryId || '',
                        isBundleChild: false,
                        sortOrder: p.additionalFields?.RCA_Sort_order__c ||
                            p.fields?.RCA_Sort_order__c ||
                            p.additionalFields?.Product2?.fields?.RCA_Sort_order__c
                    };
                });
                this.individualTotalCount = data.totalCount || data.count || (Array.isArray(newProducts) ? newProducts.length : 0);

                console.log(`✅ [executeFacetedFilter] Fetched ${newProducts.length} filtered products.`);

                // Map to UI model
                this.individualProducts = newProducts.map((p: any) => {
                    // Extract Product2 ID from selling model if available, else use product ID
                    const resolvedId = p.productSellingModelOptions?.[0]?.productId || p.id;

                    // Find default price record to get the PricebookEntry ID
                    const defaultPrice = p.prices?.find((pr: any) => pr.isDefault) || p.prices?.[0];

                    return {
                        id: resolvedId,
                        name: p.name || p.fields?.Name || 'Unknown Product',
                        family: p.additionalFields?.Family || p.fields?.Family || this.selectedDropdownOption?.Name || 'Other',
                        selected: false,
                        discount: 0,
                        quantity: 1,
                        price: defaultPrice?.price || p.unitPrice || 0,
                        pricebookEntryId: defaultPrice?.priceBookEntryId || p.pricebookEntryId || '',
                        isBundleChild: false,
                        // Access sort order from multiple possible locations in the JSON structure
                        sortOrder: p.additionalFields?.RCA_Sort_order__c ||
                            p.fields?.RCA_Sort_order__c ||
                            p.additionalFields?.Product2?.RCA_Sort_order__c ||
                            p.additionalFields?.Product2?.fields?.RCA_Sort_order__c
                    };
                });

                // Restore persistent selection state
                this.individualProducts.forEach((p: any) => {
                    if (this.persistentSelectedIndividuals.has(p.id)) {
                        p.selected = true;
                        const saved = this.persistentSelectedIndividuals.get(p.id);
                        p.discount = saved.discount;
                        p.quantity = saved.quantity;
                        this.persistentSelectedIndividuals.set(p.id, p);
                    }
                });

                // Sort by RCA_Sort_order__c if available
                this.individualProducts.sort((a: any, b: any) => {
                    const sortA = Number(a.sortOrder) || 0;
                    const sortB = Number(b.sortOrder) || 0;
                    return sortA - sortB;
                });
            },
            error: (err) => {
                console.error('Faceted filter error', err);
                this.toastService.show('Filter failed', 'error');
            }
        });
    }

    // Executes global search using CPQ Search API (v66.0) with cursor-based pagination
    executeSearch() {
        if (this.currentProductReq) {
            this.currentProductReq.unsubscribe();
        }

        // Check if search is cleared
        if (!this.productSearchTerm) {
            this.loadIndividualProducts();
            return;
        }

        this.isIndividualLoading = true;

        // Use the category ID from the discovery response
        const searchCategoryId = this.bundleCategoryId;

        // Get the cursor for the current page from the stack
        const currentCursor = this.cursorStack[this.currentCursorIndex];

        console.log(`[executeSearch] Page: ${this.currentCursorIndex + 1}, Cursor: "${currentCursor}", SearchTerm: "${this.productSearchTerm}"`);

        const criteria = this.getFilterCriteria();
        this.currentProductReq = this.salesforceApiService.searchProducts(
            this.productSearchTerm || '',
            searchCategoryId,
            criteria,
            currentCursor,
            this.individualPageSize
        ).pipe(
            finalize(() => this.isIndividualLoading = false)
        ).subscribe({
            next: (data: any) => {
                // Update nextPageCursor from API response
                this.nextPageCursor = data.cursor || null;

                // Track total size from API (if available)
                this.individualTotalCount = data.totalCount || data.count || data.totalSize || 0;

                const newProducts = data.products || data.result || [];
                console.log(`✅ [executeSearch] Fetched ${newProducts.length} products. Next Cursor: ${this.nextPageCursor}`);

                // Map to UI model with specific field mapping requirements
                this.individualProducts = newProducts
                    .filter((p: any) => p.productType !== 'Bundle') // Filter out bundles in individual tab
                    .map((p: any) => {
                        const resolvedId = p.id; // Map result[].id to Product ID

                        // Map result[].prices[0].priceBookEntryId to Pricebook Entry ID
                        const defaultPrice = p.prices?.find((pr: any) => pr.isDefault) || p.prices?.[0];

                        return {
                            id: resolvedId,
                            name: p.name || p.fields?.Name || 'Unknown Product',
                            family: this.productSearchTerm ? 'Search Result' : (this.selectedDropdownOption?.Name || 'Other'),
                            selected: false,
                            discount: 0,
                            quantity: 1,
                            price: defaultPrice?.price || p.unitPrice || 0,
                            pricebookEntryId: defaultPrice?.priceBookEntryId || p.pricebookEntryId || '',
                            isBundleChild: false,
                            // Map result[].additionalFields.Product2.RCA_Sort_order__c to SortOrder
                            sortOrder: p.additionalFields?.Product2?.RCA_Sort_order__c ||
                                p.additionalFields?.Product2?.fields?.RCA_Sort_order__c ||
                                p.additionalFields?.RCA_Sort_order__c ||
                                p.fields?.RCA_Sort_order__c
                        };
                    });

                // Restore persistent selection state
                this.individualProducts.forEach((p: any) => {
                    if (this.persistentSelectedIndividuals.has(p.id)) {
                        p.selected = true;
                        const saved = this.persistentSelectedIndividuals.get(p.id);
                        p.discount = saved.discount;
                        p.quantity = saved.quantity;
                        this.persistentSelectedIndividuals.set(p.id, p);
                    }
                });

                // Sort by RCA_Sort_order__c if available
                this.individualProducts.sort((a: any, b: any) => {
                    const sortA = Number(a.sortOrder) || 0;
                    const sortB = Number(b.sortOrder) || 0;
                    return sortA - sortB;
                });
            },
            error: (err: any) => {
                console.error('Search error', err);
                this.toastService.show('Search failed', 'error');
            }
        });
    }

    onGroupSearch() {
        console.log('🔍 [onGroupSearch] CALLED. bundleSearchTerm:', `"${this.bundleSearchTerm}"`);

        // Reset view mode to 'all' to ensure search results are visible
        this.viewMode = 'all';
        this.filterQuery = '';

        if (!this.bundleSearchTerm || this.bundleSearchTerm.trim() === '') {
            console.log('⚠️ [onGroupSearch] Term is empty or whitespace, reloading default groups');
            this.fetchProductDetails();
            return;
        }

        console.log('🚀 [onGroupSearch] Proceeding to executeGroupSearch');
        this.executeGroupSearch();
    }

    executeGroupSearch() {
        if (this.currentProductReq) {
            this.currentProductReq.unsubscribe();
        }

        this.isLoading = true;
        const searchCategoryId = this.bundleCategoryId;

        console.log('[executeGroupSearch] Using category ID from discovery:', searchCategoryId, 'with searchTerm:', this.bundleSearchTerm);

        this.currentProductReq = this.salesforceApiService.searchProductGroups(
            this.bundleSearchTerm || '',
            searchCategoryId
        ).pipe(
            finalize(() => this.isLoading = false)
        ).subscribe({
            next: (data: any) => {
                const results = data.products || data.result || [];
                console.log(`✅ [executeGroupSearch] Fetched ${results.length} bundle products.`);

                // Map search results to UI model for groups
                this.productGroups = results.map((p: any) => {
                    // Try to find matching classification to get the right classification ID
                    const match = this.allClassifications.find(c => (c.Name || '').toLowerCase() === (p.name || '').toLowerCase());

                    return {
                        id: match ? match.Id : p.id,
                        productId: p.id,
                        name: p.name || 'Unknown Bundle',
                        No_Of_Child_Products__c: p.additionalFields?.RCA_Product_Count__c ||
                            p.No_Of_Child_Products__c ||
                            p.fields?.No_Of_Child_Products__c ||
                            p.additionalFields?.No_Of_Child_Products__c ||
                            p.additionalFields?.Product2?.RCA_Product_Count__c || 0,
                        selected: false,
                        discount: 0,
                        incentiveAmount: 0,
                        pricebookEntryId: p.prices?.[0]?.priceBookEntryId || '',
                        price: p.prices?.[0]?.price || 0,
                        sortOrder: p.additionalFields?.RCA_Sort_order__c ||
                            p.fields?.RCA_Sort_order__c ||
                            p.additionalFields?.Product2?.RCA_Sort_order__c
                    };
                });

                // Restore selection state for groups
                this.productGroups.forEach(g => {
                    if (this.selectorCalledFrom === 'incentives') {
                        g.selected = this.persistentIncentiveGroups.has(g.id);
                        if (g.selected) {
                            const saved = this.persistentIncentiveGroups.get(g.id);
                            g.incentiveAmount = saved.incentiveAmount;
                        }
                    } else {
                        g.selected = this.persistentSelectedGroups.has(g.id);
                        if (g.selected) {
                            const saved = this.persistentSelectedGroups.get(g.id);
                            g.discount = saved.discount;
                        }
                    }
                });

                // Sort groups by sort order
                this.productGroups.sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
            },
            error: (err) => {
                console.error('Group search error', err);
                this.toastService.show('Group search failed', 'error');
            }
        });
    }

    onSearchTermChange(term: string) {
        if (!term || term.trim() === '') {
            this.productSearchTerm = '';
            this.onProductSearch();
        }
    }

    onGroupSearchTermChange(term: string) {
        console.log('✍️ [onGroupSearchTermChange] New Term:', `"${term}"`, 'Current bundleSearchTerm:', `"${this.bundleSearchTerm}"`);
        if (!term || term.trim() === '') {
            console.log('🧹 [onGroupSearchTermChange] Term cleared, reloading groups');
            this.bundleSearchTerm = '';
            this.onGroupSearch();
        }
    }

    mapNewProductData(items: any[]) {
        console.log(`🗺️ [mapNewProductData] Mapping ${items.length} items to productGroups.`);
        this.productGroups = items.map(item => ({
            id: item.id || item.Id,
            name: item.name || item.Name,
            No_Of_Child_Products__c: item.additionalFields?.RCA_Product_Count__c ||
                item.additionalFields?.Product2?.RCA_Product_Count__c ||
                item.No_Of_Child_Products__c || 0,
            selected: false,
            discount: 0,
            price: item.prices?.[0]?.price || 0,
            pricebookEntryId: item.prices?.[0]?.priceBookEntryId || '',
            isBundleChild: false,
            sortOrder: item.additionalFields?.RCA_Sort_order__c,
            components: []
        }));
        console.log(`✅ [mapNewProductData] productGroups updated. Count: ${this.productGroups.length}`);
        this.syncSelectionState();
    }



    mapProductData(data: any) {
        // Extract the actual product object. API returns { products: [...] } for bundle queries.
        const product = (data.products && data.products.length > 0) ? data.products[0] : data;

        // Map Groups
        if (product.productComponentGroups && product.productComponentGroups.length > 0) {

            this.productGroups = product.productComponentGroups.map((group: any) => ({
                id: group.id,
                name: group.name || 'Group',
                count: group.components?.length || 0,
                selected: false,
                discount: 0,
                components: group.components
            }));

            // Flatten all components for the Individual List
            const allComponents: any[] = [];
            product.productComponentGroups.forEach((group: any) => {
                if (group.components) {
                    group.components.forEach((comp: any) => {
                        // Only add actual components, ignore selling model options if they appear here (unlikely but safe)
                        const resolvedId = comp.productSellingModelOptions?.[0]?.productId || comp.id;
                        const defaultPrice = comp.prices?.find((pr: any) => pr.isDefault) || comp.prices?.[0];

                        allComponents.push({
                            id: resolvedId,
                            name: comp.name,
                            family: group.name, // Use group name as family
                            selected: false,
                            discount: 0,
                            quantity: 1,
                            price: defaultPrice?.price || comp.unitPrice || 0,
                            pricebookEntryId: defaultPrice?.priceBookEntryId || comp.pricebookEntryId || '',
                            isBundleChild: true, // Components in groups are usually children
                            sortOrder: comp.additionalFields?.RCA_Sort_order__c
                        });
                    });
                }
            });
            this.individualProducts = allComponents;


        } else {
            // Fallback for simple/standalone products without groups

            // Check if it's a valid product response even without groups
            if (product.id && product.name) {
                this.productGroups = []; // No groups to show
                this.individualProducts = [{
                    id: product.id,
                    name: product.name || 'Product',
                    family: 'Standalone',
                    selected: false,
                    discount: 0,
                    quantity: 1,
                    price: product.unitPrice || 0,
                    pricebookEntryId: product.pricebookEntryId || '',
                    isBundleChild: false
                }];
            }
        }
        // Restore persistent selection state based on current context
        this.syncSelectionState();
    }
    confirmProductSelection() {
        if (this.activeTab === 'discounts' && this.discountForm.granularity === 'Granular') {
            const selectedGroups = Array.from(this.persistentSelectedGroups.values()).filter(g => g.selected);
            const selectedIndividuals = Array.from(this.persistentSelectedIndividuals.values()).filter(p => p.selected);

            const invalidItems = [...selectedGroups, ...selectedIndividuals].filter(item => {
                return item.discount === null || item.discount === undefined || item.discount < 1 || item.discount > 100;
            });

            if (invalidItems.length > 0) {
                this.toastService.show('Please provide a 1 to 100% discount for all selected products, or unselect them.', 'warning');
                return; // Prevent closing
            }
        }

        // Clear snapshots - we are committing these changes
        this.snapshotSelectedGroups.clear();
        this.snapshotSelectedIndividuals.clear();
        this.snapshotIncentiveGroups.clear();

        this.closeProductSelector(false); // Close without rollback
        this.saveCurrentState(); // Persist selections to session
    }

    // Picklist Filter Methods
    loadPicklistOptions() {
        // Load options for Region and Billing Frequency filters
        if (this.picklistLoaded || this.isPicklistLoading) return;

        this.isPicklistLoading = true;
        this.salesforceApiService.getProductPicklistValues().subscribe({
            next: (res: any) => {
                // Salesforce UI API picklist-values returns picklistFieldValues map
                const fields = res?.picklistFieldValues || res || {};

                // Extract values with extra safety checks
                const bfData = fields?.RCA_Billing_Frequency__c || fields?.billing_frequency;
                const regData = fields?.RCA_Region__c || fields?.region;

                this.billingFreqOptions = (bfData?.values || []).map((v: any) => ({ label: v.label, value: v.value }));
                this.regionOptions = (regData?.values || []).map((v: any) => ({ label: v.label, value: v.value }));

                console.log('Picklist options loaded:', {
                    regions: this.regionOptions.length,
                    billing: this.billingFreqOptions.length
                });

                this.picklistLoaded = true;
                this.isPicklistLoading = false;
            },
            error: (err) => {
                console.error('Failed to load picklist values', err);
                this.isPicklistLoading = false;
            }
        });
    }

    selectRegion(opt: { label: string; value: string } | null) {
        this.selectedRegion = opt;
        this.regionDropdownOpen = false;
        this.regionSearchText = '';
        // As requested: remove existing search values when selecting a filter
        this.productSearchTerm = '';

        // Reset Cursor Pagination for the new filter selection
        this.cursorStack = [''];
        this.currentCursorIndex = 0;
        this.nextPageCursor = null;

        if (this.productTab === 'individual') this.applyFilters();
    }

    selectBillingFreq(opt: { label: string; value: string } | null) {
        this.selectedBillingFreq = opt;
        this.billingDropdownOpen = false;
        this.billingSearchText = '';
        // As requested: remove existing search values when selecting a filter
        this.productSearchTerm = '';

        // Reset Cursor Pagination for the new filter selection
        this.cursorStack = [''];
        this.currentCursorIndex = 0;
        this.nextPageCursor = null;

        if (this.productTab === 'individual') this.applyFilters();
    }

    closeAllPicklistDropdowns() {
        this.regionDropdownOpen = false;
        this.billingDropdownOpen = false;
    }

    closeProductSelector(isCancel: boolean = true) {
        if (isCancel) {
            // Revert selection state from snapshots
            this.persistentSelectedGroups = new Map(this.snapshotSelectedGroups);
            this.persistentSelectedIndividuals = new Map(this.snapshotSelectedIndividuals);
            this.persistentIncentiveGroups = new Map(this.snapshotIncentiveGroups);

            // Sync the .selected property for items currently in view
            this.syncSelectionState();

            console.log('🔄 [Selection Management] Cancelled selection. Rolled back to previous state.');
        } else {
            console.log('✅ [Selection Management] Confirmed selection.');
        }

        this.showProductSelector = false;
        this.viewMode = 'all'; // Always reset view mode back to "Show All" on close
        // Reset search/filters when closing
        this.productSearchTerm = '';
        this.bundleSearchTerm = '';
        this.dropdownSearchText = '';
        this.filterQuery = '';
        this.selectedRegion = null;
        this.selectedBillingFreq = null;
        this.regionSearchText = '';
        this.billingSearchText = '';
    }

    switchProductTab(tab: 'groups' | 'individual') {
        this.productTab = tab;
        this.filterQuery = ''; // Reset filter on switch
        this.viewMode = 'all'; // Reset to "Show All" when switching tabs

        // If individual products are empty, trigger load for the selected dropdown option
        if (tab === 'individual') {
            if (this.individualProducts.length === 0 && this.selectedDropdownOption) {
                this.loadIndividualProducts();
            }
        }
    }

    toggleItem(item: any) {
        // Validation: Limit products
        if (!item.selected) {
            if (this.liveQuotaRemaining <= 0) {
                this.toastService.show(`Maximum product limit reached. Check the remaining quota in the header.`, 'warning');
                return;
            }
        }

        item.selected = !item.selected;
        if (!item.selected) {
            item.discount = 0;
        }
        if (this.selectorCalledFrom === 'incentives') {
            // For incentives only track group selections
            if (this.productTab === 'groups') {
                if (item.selected) {
                    this.persistentIncentiveGroups.set(item.id, item);
                } else {
                    this.persistentIncentiveGroups.delete(item.id);
                }
            }
            return;
        }
        const map = this.productTab === 'groups' ? this.persistentSelectedGroups : this.persistentSelectedIndividuals;
        if (item.selected) {
            map.set(item.id, item);
        } else {
            map.delete(item.id);
        }
    }

    updatePersistentSelected(item: any) {
        if (!item.selected) return;

        // Validation for Discount (only relevant for discounts flow)
        if (this.selectorCalledFrom !== 'incentives') {
            if (item.discount !== null && item.discount !== undefined && item.discount !== '') {
                let val = Number(item.discount);
                if (isNaN(val)) val = 0;
                if (val < 0) val = 0;
                if (val > 100) {
                    this.toastService.show('Discount cannot be more than 100%.', 'error');
                    item.discount = null;
                } else {
                    item.discount = val;
                }
            } else if (item.discount === '') {
                item.discount = null;
            }
        }

        let map: Map<string, any>;
        if (this.selectorCalledFrom === 'incentives') {
            map = this.persistentIncentiveGroups;
        } else {
            map = this.productTab === 'groups' ? this.persistentSelectedGroups : this.persistentSelectedIndividuals;
        }
        map.set(item.id, item);
    }

    clearDiscountZero(item: any) {
        if (item.discount === 0) {
            item.discount = null;
        }
    }

    restoreDiscountZero(item: any) {
        if (item.discount === null || item.discount === undefined || item.discount === '') {
            item.discount = 0;
            this.updatePersistentSelected(item);
        }
    }


    setViewMode(mode: 'all' | 'selected') {
        this.viewMode = mode;
    }

    handleSort(column: string) {
        if (this.sortConfig.column === column) {
            this.sortConfig.direction = this.sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortConfig.column = column;
            this.sortConfig.direction = 'asc';
        }
    }

    get filteredItems(): any[] {
        let items: any[] = this.productTab === 'groups' ? this.productGroups : this.individualProducts;

        // 1. Filter by Search Query
        if (this.filterQuery) {
            const lowerQuery = this.filterQuery.toLowerCase();
            items = items.filter(item =>
                (item.name || '').toLowerCase().includes(lowerQuery) ||
                (item.family && item.family.toLowerCase().includes(lowerQuery))
            );
        }

        // 2. Filter by View Mode (Selected Only)
        if (this.viewMode === 'selected') {
            let map: Map<string, any>;
            if (this.selectorCalledFrom === 'incentives') {
                map = this.persistentIncentiveGroups;
            } else {
                map = this.productTab === 'groups' ? this.persistentSelectedGroups : this.persistentSelectedIndividuals;
            }

            return Array.from(map.values()).sort((a, b) => {
                const valA = a[this.sortConfig.column];
                const valB = b[this.sortConfig.column];
                if (valA < valB) return this.sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return this.sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        // 3. Sort
        return items.sort((a, b) => {
            const valA = a[this.sortConfig.column];
            const valB = b[this.sortConfig.column];

            // Simple string/number compare
            if (valA < valB) return this.sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    getSelectedCount(type: 'groups' | 'individual'): number {
        if (this.selectorCalledFrom === 'incentives') {
            return type === 'groups' ? this.persistentIncentiveGroups.size : 0;
        }
        const map = type === 'groups' ? this.persistentSelectedGroups : this.persistentSelectedIndividuals;
        return map.size;
    }

    get isAllSelected(): boolean {
        const items = this.filteredItems;
        return items.length > 0 && items.every(item => item.selected);
    }

    toggleSelectAll() {
        const allSelected = this.isAllSelected;
        let blockedByLimit = false;

        // Pick the correct map based on current context
        let map: Map<string, any>;
        if (this.selectorCalledFrom === 'incentives') {
            map = this.persistentIncentiveGroups;
        } else {
            map = this.productTab === 'groups' ? this.persistentSelectedGroups : this.persistentSelectedIndividuals;
        }

        // remainingQuota is the number of items we can still select RIGHT NOW
        let availableQuota = this.remainingQuota;

        this.filteredItems.forEach(item => {
            const becomingSelected = !allSelected;

            // Check limit when selecting
            if (becomingSelected && !item.selected) {
                if (availableQuota <= 0) {
                    blockedByLimit = true;
                    return; // Skip this one
                }
                availableQuota--;
            } else if (!becomingSelected && item.selected) {
                availableQuota++;
            }

            item.selected = becomingSelected;
            if (item.selected) {
                map.set(item.id, item);
            } else {
                map.delete(item.id);
            }
        });

        if (blockedByLimit) {
            this.toastService.show(`Selection partially blocked: Maximum product limit reached. Check the remaining quota in the header.`, 'warning');
        }
    }

    // Management Actions
    async addDiscount() {
        if (!this.activeDiscountPeriod) {
            this.toastService.show('Please select a discount period first.', 'warning');
            this.periodDropdownOpen = true;
            return;
        }

        if (!this.activeDiscountPeriod.startDate || !this.activeDiscountPeriod.endDate) {
            this.toastService.show('Please select both Start and End dates for the active discount period.', 'warning');
            return;
        }

        if (this.discountForm.granularity === 'Select') {
            this.toastService.show('Please select discount granularity', 'warning');
            return;
        }

        const selectedGroups = Array.from(this.persistentSelectedGroups.values()).filter(g => g.selected);
        const selectedIndividuals = Array.from(this.persistentSelectedIndividuals.values()).filter(p => p.selected);

        if (selectedGroups.length === 0 && selectedIndividuals.length === 0) {
            this.toastService.show('Please select at least one product or group', 'warning');
            return;
        }

        // Validation for Discount Value
        if (this.discountForm.granularity === 'Overall') {
            const overallDisc = parseFloat(this.discountForm.value);
            if (!overallDisc || overallDisc <= 0) {
                this.toastService.show('Please enter a valid discount value greater than 0%.', 'warning');
                return;
            }
            if (overallDisc > 100) {
                this.toastService.show('Discount cannot be more than 100%.', 'error');
                this.discountForm.value = '';
                return;
            }
        } else {
            // Granular: Ensure ALL selected items have a discount between 1 and 100
            const invalidItems = [...selectedGroups, ...selectedIndividuals].filter(item => {
                return item.discount === null || item.discount === undefined || item.discount < 1 || item.discount > 100;
            });
            if (invalidItems.length > 0) {
                this.toastService.show('Please provide a 1 to 100% discount for all selected products, or unselect them.', 'warning');
                return;
            }
        }

        this.isLoading = true;
        this.loadingService.show();
        let selectedItemsMap = new Map<string, any>();

        try {
            // 1. Process Groups using pre-fetched dropdownOptions (Call 2 results)
            for (const group of selectedGroups) {

                // Find matching option in dropdownOptions which already has pricebookEntryId and sortOrder
                const match = this.dropdownOptions.find(opt => opt.Name === group.name || opt.Id === group.productId);

                if (match) {
                    selectedItemsMap.set(group.id, {
                        id: match.Id, // Product2Id
                        name: group.name,
                        discount: group.discount || 0,
                        quantity: 1,
                        price: match.price || 0,
                        pricebookEntryId: match.pricebookEntryId || '',
                        sortOrder: match.sortOrder,
                        isBundleChild: false
                    });
                } else {
                    // Fallback to what we have in the group object
                    selectedItemsMap.set(group.id, {
                        id: group.productId || group.id,
                        name: group.name,
                        discount: group.discount || 0,
                        quantity: 1,
                        price: group.price || 0,
                        pricebookEntryId: group.pricebookEntryId || '',
                        sortOrder: group.sortOrder,
                        isBundleChild: false
                    });
                }
            }

            // 2. Collect from Individual Products
            selectedIndividuals.forEach(p => {
                selectedItemsMap.set(p.id, {
                    id: p.id,
                    name: p.name,
                    discount: p.discount || 0,
                    quantity: p.quantity || 1,
                    price: p.price || 0,
                    pricebookEntryId: p.pricebookEntryId || '',
                    sortOrder: p.sortOrder,
                    isBundleChild: p.isBundleChild
                });
            });

            const selectedItems = Array.from(selectedItemsMap.values());

            if (selectedItems.length === 0) {
                this.toastService.show('Failed to resolve IDs for selected items', 'error');
                this.loadingService.hide();
                this.isLoading = false;
                return;
            }

            // Apply overall discount if applicable
            if (this.discountForm.granularity === 'Overall' && this.discountForm.value) {
                const overallDisc = parseFloat(this.discountForm.value) || 0;
                selectedItems.forEach(item => {
                    item.discount = overallDisc;
                });
            }

            console.log('[Discounts] Final Selected Items (Mapped):', selectedItems);
            this.handleGranularDiscount(selectedItems);

        } catch (err) {
            console.error('[Discounts] Error in addDiscount:', err);
            this.toastService.show('An error occurred while processing discounts', 'error');
            this.loadingService.hide();
            this.isLoading = false;
        }
    }

    handleBulkUpload(csvData: any[]) {
        if (!csvData || csvData.length === 0) return;

        const quoteId = this.activeQuoteId;
        if (!quoteId) {
            this.toastService.show('No active quote found for upload', 'error');
            return;
        }

        this.isLoading = true;
        this.loadingService.show();
        const startTime = performance.now();

        // Map CSV data to the format expected by handleGranularDiscount (or similar)
        const itemsToUpload = csvData.map(row => ({
            id: row['ProductID'],
            name: row['ProductName'],
            discount: parseFloat(row['Discount %']) || 0,
            quantity: 1,
            pricebookEntryId: row['PricebookEntryID'],
            sortOrder: row['SortOrder'],
            isBundleChild: false
        }));

        this.processBulkDiscount(itemsToUpload, startTime);
    }

    private processBulkDiscount(selectedItems: any[], startTime: number) {
        const quoteId = this.activeQuoteId;
        const DEFAULT_PBE_ID = '01uDz00000dqLY8IAM';

        if (!quoteId) {
            this.toastService.show('No active quote found for upload', 'error');
            return;
        }

        const records: any[] = [];

        // A. Add Quote PATCH record for consistency with existing flow
        records.push({
            "referenceId": "refQuote",
            "record": {
                "attributes": { "method": "PATCH", "type": "Quote", "id": quoteId }
            }
        });

        // B. Build QuoteLineItems for all items in the CSV
        selectedItems.forEach((item, index) => {
            const lineRecord = {
                "attributes": { "type": "QuoteLineItem", "method": "POST" },
                "QuoteId": quoteId,
                "Product2Id": item.id,
                "ProductName": item.name,
                "PricebookEntryId": item.pricebookEntryId || DEFAULT_PBE_ID,
                "StartDate": this.activeDiscountPeriod?.startDate,
                "EndDate": this.activeDiscountPeriod?.endDate,
                "PeriodBoundary": "Anniversary",
                "Quantity": 1,
                "Discount": item.discount,
                "SortOrder": Number(item.sortOrder) || 0
            };
            records.push({
                "referenceId": `refBulk_${index}`,
                "record": lineRecord
            });
        });

        const transactionPayload = {
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
                "graphId": "bulkUploadDiscountGraph",
                "records": records
            }
        };

        // Staging locally instead of immediate API call
        this.discountIncentiveStateService.addPendingTransaction(transactionPayload, quoteId);
        
        const endTime = performance.now();
        const responseTimeSecs = ((endTime - startTime) / 1000).toFixed(2);
        this.toastService.show(`${selectedItems.length} products staged locally (${responseTimeSecs}s)`, 'success');

        // Track bulk uploaded Product2 IDs for preview classification
        selectedItems.forEach(item => {
            if (item.id) this.bulkUploadedProductIds.add(item.id);
        });

        // Add to UI summary
        this.addDiscountToUI('Bulk Upload', 0, selectedItems.length, 'CSV Data', selectedItems.length, responseTimeSecs, selectedItems.map(item => item.id));

        this.saveCurrentState(); // Persist bulk IDs
        this.dataFetched = false;
        this.showProductSelector = false;
        this.router.navigate(['/quote-configuration']);
        console.log('✅ Bulk Upload staged locally. Redirecting to Configure Quote.');
        
        this.isLoading = false;
        this.loadingService.hide();
    }

    handleGranularDiscount(selectedItems: any[]) {
        const quoteId = this.activeQuoteId;
        const DEFAULT_PBE_ID = '01uDz00000dqLY8IAM';

        if (!quoteId) {
            this.toastService.show('No active quote found in context', 'error');
            return;
        }

        this.isLoading = true;
        this.loadingService.show();
        const startTime = performance.now();

                const records: any[] = [];

                // A. Add Quote PATCH record
                records.push({
                    "referenceId": "refQuote",
                    "record": {
                        "attributes": {
                            "method": "PATCH",
                            "type": "Quote",
                            "id": quoteId
                        }
                    }
                });

                // B. Build QuoteLineItems
                selectedItems.forEach((item, index) => {
                    let pbeId = item.pricebookEntryId || DEFAULT_PBE_ID;
                    let productId = item.id;
                    let sortOrder = item.sortOrder;

                    // Fallback PBE if still missing
                    pbeId = pbeId || '01uDz00000dqLY8IAM';

                    const lineRefId = `refLine_${index}`;
                    const lineRecord: any = {
                        "attributes": { "type": "QuoteLineItem", "method": "POST" },
                        "QuoteId": quoteId,
                        "Product2Id": productId,
                        "ProductName": item.name,
                        "PricebookEntryId": pbeId,
                        "StartDate": this.activeDiscountPeriod?.startDate,
                        "EndDate": this.activeDiscountPeriod?.endDate,
                        "PeriodBoundary": "Anniversary",
                        "Quantity": Number(item.quantity) || 1,
                        "Discount": Number(item.discount) || 0,
                        "SortOrder": Number(sortOrder) || 0
                    };

                    records.push({
                        "referenceId": lineRefId,
                        "record": lineRecord
                    });
                });

                if (records.length <= 1) {
                    this.toastService.show('No valid products to add', 'warning');
                    this.isLoading = false;
                    this.loadingService.hide();
                    return;
                }

                const transactionPayload = {
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

                // Stage locally instead of immediate API call
                this.discountIncentiveStateService.addPendingTransaction(transactionPayload, quoteId);

                const endTime = performance.now();
                const responseTimeSecs = ((endTime - startTime) / 1000).toFixed(2);
                this.toastService.show(`Changes staged locally. Click Save to confirm. (${responseTimeSecs}s)`, 'success');
                const selectedGroupCount = this.persistentSelectedGroups.size;
                const selectedIndividualCount = this.persistentSelectedIndividuals.size;
                const discValue = this.discountForm.value ? this.discountForm.value + '%' : 'Updated';

                // Count committed items = selected groups + selected individuals (line items added)
                const committedCount = this.persistentSelectedGroups.size + selectedIndividualCount;

                this.addDiscountToUI(this.discountForm.granularity, selectedGroupCount, selectedIndividualCount, discValue, committedCount, responseTimeSecs, selectedItems.map(item => item.id));
                this.resetSelections();
                // Reset dataFetched so that next time the component is opened it can refresh data if needed
                this.dataFetched = false;
                this.saveCurrentState(); // Persist discounts locally

                this.showProductSelector = false;
                this.router.navigate(['/quote-configuration']);
                
                this.isLoading = false;
                this.loadingService.hide();
    }

    private addDiscountToUI(granularity: string, groupCount: number, individualCount: number, value: string, committedProductCount: number = 0, responseTimeSecs?: string, productIds: string[] = []) {

        let title = `${granularity} Discount - Flat Rate (%)`;
        let subtext = `${groupCount} Product Groups, ${individualCount} Products ${responseTimeSecs ? '(' + responseTimeSecs + 's)' : ''}`;

        if (granularity === 'Bulk Upload') {
            title = 'Bulk Uploaded Products';
            subtext = `${individualCount} Products processed ${responseTimeSecs ? '(' + responseTimeSecs + 's)' : ''}`;
        }

        const newDiscount = {
            id: 'd' + Date.now(),
            title: title,
            subtext: subtext,
            value: value,
            type: 'discount',
            granularity: granularity,
            itemCount: committedProductCount,
            responseTime: responseTimeSecs,
            productIds
        };
        if (!this.activeDiscountPeriod) return;
        this.activeDiscountPeriod.activeDiscounts.push(newDiscount); // Add to bottom
    }

    applyErrorProductUpdates(payload: any) {
        const mode = payload?.mode;
        const activeItems = (payload?.updatedItems || []).filter((item: any) => !item.deleted);
        const activeCount = activeItems.length;
        const values = activeItems.map((item: any) => item.value).filter((value: any) => value !== null && value !== undefined && value !== '');
        const uniqueValues = Array.from(new Set(values.map((value: any) => String(value))));

        if (mode === 'discount') {
            const displayValue = uniqueValues.length === 1 ? `${uniqueValues[0]}%` : 'Updated';
            this.discountPeriods.forEach((period: any) => {
                period.activeDiscounts.forEach((discount: any) => {
                    discount.value = displayValue;
                    discount.itemCount = activeCount;
                    if (discount.responseTime) {
                        discount.subtext = discount.subtext?.replace(/\(([^)]*)s\)/, `(${discount.responseTime}s)`) || discount.subtext;
                    }
                });
            });
        }

        if (mode === 'incentive') {
            const displayValue = uniqueValues.length === 1 ? `$${uniqueValues[0]}` : `${activeCount} group${activeCount !== 1 ? 's' : ''} with custom amounts`;
            this.incentivePeriods.forEach((period: any) => {
                period.activeIncentives.forEach((incentive: any) => {
                    incentive.value = displayValue;
                    incentive.itemCount = activeCount;
                });
            });
        }

        this.saveCurrentState();
    }

    addIncentive() {
        if (!this.activeIncentivePeriod.startDate || !this.activeIncentivePeriod.endDate) {
            this.toastService.show('Please select both Start and End dates for the active incentive period.', 'warning');
            return;
        }

        if (this.incentiveForm.type === 'Select') {
            this.toastService.show('Please select incentive type', 'warning');
            return;
        }

        const selectedGroups = Array.from(this.persistentIncentiveGroups.values()).filter(g => g.selected);
        if (selectedGroups.length === 0) {
            this.toastService.show('Please select at least one Product Group', 'warning');
            return;
        }

        // Always granular: validate each selected group has an amount
        const invalidGroups = selectedGroups.filter(g => !g.incentiveAmount || parseFloat(g.incentiveAmount) <= 0);
        if (invalidGroups.length > 0) {
            this.toastService.show('Please enter a valid incentive amount for all selected Product Groups.', 'warning');
            return;
        }

        const quoteId = this.activeQuoteId;
        if (!quoteId) {
            this.toastService.show('No active quote found in context', 'error');
            return;
        }

        this.isLoading = true;
        this.loadingService.show();
        const startTime = performance.now();

        const contextPricebookId = this.activePricebookId;
        const resolvedItems: any[] = [];
        for (const group of selectedGroups) {
            // Find match in dropdownOptions for the group (Call 2 results)
            const match = this.dropdownOptions.find(opt => opt.Name === group.name);

            resolvedItems.push({
                id: match ? match.Id : group.id, // Use Product2Id if found
                name: group.name,
                pbeId: match ? match.pricebookEntryId : (group.pricebookEntryId || ''),
                sortOrder: match ? match.sortOrder : group.sortOrder,
                incentiveAmount: group.incentiveAmount
            });
        }

                const records: any[] = [
                    {
                        "referenceId": "refQuote",
                        "record": {
                            "attributes": { "method": "PATCH", "type": "Quote", "id": quoteId }
                        }
                    }
                ];

                // Building records
                resolvedItems.forEach((item, index) => {
                    const lineRecord: any = {
                        "attributes": { "type": "QuoteLineItem", "method": "POST" },
                        "QuoteId": quoteId,
                        "Product2Id": item.id,
                        "ProductName": item.name,
                        "PricebookEntryId": item.pbeId || '01uDz00000dqLY8IAM',
                        "StartDate": this.activeIncentivePeriod.startDate,
                        "EndDate": this.activeIncentivePeriod.endDate,
                        "PeriodBoundary": "Anniversary",
                        "Quantity": 1,
                        "Incentive__c": parseFloat(item.incentiveAmount) || 0,
                        "SortOrder": Number(item.sortOrder) || 0
                    };

                    records.push({
                        "referenceId": `refIncentive_${index}`,
                        "record": lineRecord
                    });
                });

                const payload = {
                    "pricingPref": "Skip",
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
                        "graphId": "insert_incentive",
                        "records": records
                    }
                };

                // Stage locally instead of API call
                this.discountIncentiveStateService.addPendingTransaction(payload, quoteId);

                const endTime = performance.now();
                const responseTimeSecs = ((endTime - startTime) / 1000).toFixed(2);
                this.toastService.show(`Changes staged locally. Click Save to confirm. (${responseTimeSecs}s)`, 'success');
                const groupCount = selectedGroups.length;
                const displayValue = `${groupCount} group${groupCount !== 1 ? 's' : ''} with custom amounts`;
                this.activeIncentivePeriod.activeIncentives.push({
                    id: 'i' + Date.now(),
                    title: this.incentiveForm.type,
                    subtext: `${groupCount} Product Group${groupCount !== 1 ? 's' : ''} (${responseTimeSecs}s)`,
                    value: displayValue,
                    type: 'incentive',
                    itemCount: groupCount,
                    responseTime: responseTimeSecs,
                    productIds: resolvedItems.map(item => item.id)
                });
                this.incentiveForm.amount = '';
                this.persistentIncentiveGroups.clear();
                this.productGroups.forEach(g => { g.selected = false; });
                this.dataFetched = false;
                this.saveCurrentState(); // Persist incentives locally
                
                this.isLoading = false;
                this.loadingService.hide();
    }

    get totalProductsCount(): number {
        // Treat each selected group as ONE product line item
        return this.persistentSelectedGroups.size + this.persistentSelectedIndividuals.size;
    }

    duplicateItem(item: any, period: any) {
        const newItem = { ...item, id: Date.now().toString() };
        if (item.type === 'discount') {
            period.activeDiscounts.push(newItem);
        } else {
            period.activeIncentives.push(newItem);
        }
        this.openActionMenuId = null;
        this.toastService.show('Item duplicated', 'success');
        this.saveCurrentState();
    }

    deleteItem(item: any, period: any) {
        if (item.type === 'discount') {
            period.activeDiscounts = period.activeDiscounts.filter((d: any) => d.id !== item.id);
        } else {
            period.activeIncentives = period.activeIncentives.filter((i: any) => i.id !== item.id);
        }
        this.openActionMenuId = null;
        this.toastService.show('Item deleted', 'success');
        this.saveCurrentState();
    }

    toggleActionMenu(id: string) {
        this.openActionMenuId = this.openActionMenuId === id ? null : id;
    }

    resetSelections() {
        this.productGroups.forEach(g => {
            g.selected = false;
            g.discount = 0;
            g.incentiveAmount = 0;
        });
        this.individualProducts.forEach(p => {
            p.selected = false;
            p.discount = 0;
        });
        this.persistentSelectedGroups.clear();
        this.persistentSelectedIndividuals.clear();
        this.persistentIncentiveGroups.clear();
        this.discountForm.value = '';
        this.discountForm.granularity = 'Select';
        this.discountForm.priceReference = 'Select';
        this.incentiveForm.type = 'Select';
    }
    restrictNumeric(event: KeyboardEvent) {
        const allowedKeys = ['Backspace', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'Delete', 'End', 'Home'];
        if (allowedKeys.includes(event.key)) return;

        const isDigit = /[0-9]/.test(event.key);
        const isDot = event.key === '.';

        if (!isDigit && !isDot) {
            event.preventDefault();
        }

        if (isDot && (event.target as HTMLInputElement).value.includes('.')) {
            event.preventDefault();
        }
    }
}
