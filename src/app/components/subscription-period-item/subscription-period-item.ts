import { Component, EventEmitter, HostListener, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../services/toast.service';

export interface ProductItem {
    category: string;
    name: string;
    price?: number;
    nonProdPrice?: number;
    frequency?: string;
    productId?: string;
    pricebookEntryId?: string;
    psmId?: string;
    relComponentId?: string;
    nonProdProductId?: string | null;
    nonProdPricebookEntryId?: string | null;
    nonProdPsmId?: string | null;
    nonProdRelComponentId?: string | null;
    nonProdProductName?: string | null;
}

export interface UserTypeRow {
    type: string;
    quantity: number | null;
    region: string;
    gcpProjectId: string;
    lookerInstanceId: string;
    discount: number | null;
    price?: number;
    frequency?: string;
    productId?: string;
    pricebookEntryId?: string;
    psmId?: string;
    relComponentId?: string;
    name?: string;
}

export interface SubscriptionPeriod {
    id: string;
    name: string;
    productCategory: string;
    productName: string;
    startDate: string;
    endDate: string;
    discount: number | null;
    unitPrice: number | null;
    unitPriceFrequency?: string; // Added
    nonProdPrice: number | null;
    isExpanded: boolean;
    userRows: UserTypeRow[];
    productId?: string;
    pricebookEntryId?: string;
    psmId?: string;
    relComponentId?: string;
    nonProdProductId?: string | null;
    nonProdPricebookEntryId?: string | null;
    nonProdPsmId?: string | null;
    nonProdRelComponentId?: string | null;
    nonProdProductName?: string | null;
    durationDays?: number; // Added
    isManual?: boolean;
}

@Component({
    selector: 'app-subscription-period-item',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './subscription-period-item.html',
    styles: [`
    .custom-scrollbar::-webkit-scrollbar {
      width: 8px;
      display: block !important;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 4px;
      border: 2px solid #f1f1f1;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
    /* Ensure the dropdown is visible over all containers */
    .region-dropdown {
      display: block !important;
      visibility: visible !important;
      z-index: 10000 !important;
    }
  `]
})
export class SubscriptionPeriodItemComponent implements OnInit {
    private _period!: SubscriptionPeriod;
    @Input()
    set period(value: SubscriptionPeriod) {
        this._period = value;
        if (value) {
            this.lastValidStartDate = value.startDate;
            this.lastValidEndDate = value.endDate;
        }
    }
    get period(): SubscriptionPeriod {
        return this._period;
    }
    private _products: ProductItem[] = [];
    @Input()
    set products(value: ProductItem[]) {
        console.log('📦 SubscriptionPeriodItem: Received products:', value);
        this._products = value;
    }
    get products(): ProductItem[] {
        return this._products;
    }
    @Output() remove = new EventEmitter<void>();
    @Output() productChanged = new EventEmitter<void>();
    private toastService = inject(ToastService);
    activeRegionIndex: number | null = null;

    private _remainingQuota: number = 1000;
    @Input()
    set remainingQuota(value: number) {
        this._remainingQuota = value;
    }
    get remainingQuota(): number {
        return this._remainingQuota;
    }
    @Input() subscriptionStartDate: string = '';
    @Input() subscriptionEndDate: string = '';
    @Input() frequency: string = 'Yearly';
    @Input() previousPeriodEndDate: string = '';
    @Input() regionOptions: string[] = [];
    @Input() isFirst: boolean = false;
    @Input() isLast: boolean = false;
    @Input() periodIndex: number = 0;
    @Input() errors: { message: string; messageType: string; category?: string }[] = [];

    minDate: string = new Date().toISOString().split('T')[0];
    private lastValidStartDate: string = '';
    private lastValidEndDate: string = '';
    menuOpen: boolean = false;
    platformDropdownOpen: boolean = false;

    ngOnInit() {
        if (this.period) {
            this.lastValidStartDate = this.period.startDate;
            this.lastValidEndDate = this.period.endDate;
            if (!this.period.durationDays) {
                this.updateDurationDays();
            }
        }
    }

    toggleMenu(event: Event) {
        this.menuOpen = !this.menuOpen;
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        const isMenuClick = target.closest('.period-menu-container');

        if (!isMenuClick) {
            this.menuOpen = false;
        }

        // Always close region dropdowns if clicking outside the region area
        const isRegionClick = target.closest('.region-dropdown-container');
        if (!isRegionClick) {
            this.activeRegionIndex = null;
        }

        // Close platform dropdown if clicking outside
        const isPlatformClick = target.closest('.platform-dropdown-container');
        if (!isPlatformClick) {
            this.platformDropdownOpen = false;
        }
    }

    private updateDurationDays() {
        if (this.period.startDate && this.period.endDate) {
            const start = this.parseDateString(this.period.startDate);
            const end = this.parseDateString(this.period.endDate);
            const diffTime = Math.abs(end.getTime() - start.getTime());
            this.period.durationDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
        }
    }

    onStartDateChange() {
        if (!this.period.startDate) return;
        const start = this.parseDateString(this.period.startDate);
        const startIso = this.toIsoDateString(start);
        const freq = (this.frequency || '').toLowerCase();

        // Custom Frequency Logic
        if (freq === 'custom') {
            if (!this.isFirst) {
                if (this.previousPeriodEndDate) {
                    const prevEnd = this.parseDateString(this.previousPeriodEndDate);
                    const expectedStart = new Date(prevEnd.getTime());
                    expectedStart.setDate(expectedStart.getDate() + 1);
                    const expectedStartIso = this.toIsoDateString(expectedStart);

                    if (startIso !== expectedStartIso) {
                        this.toastService.show('Start date must be exactly one day after the previous period end date.', 'error');
                        this.period.startDate = '';
                    }
                } else {
                    this.toastService.show('Please enter the previous period end date first.', 'error');
                    this.period.startDate = '';
                }
            } else if (this.subscriptionStartDate && startIso !== this.subscriptionStartDate) {
                this.toastService.show('The Period 1 start date must equal to subscription start date.', 'error');
                this.period.startDate = '';
            }
        } else {
            // Non-Custom (Yearly) Frequency Logic
            if (this.isFirst && this.subscriptionStartDate && startIso !== this.subscriptionStartDate) {
                this.toastService.show('The Period 1 start date must equal to subscription start date', 'error');
                this.period.startDate = '';
            }
        }

        this.validateAndUpdate();
    }

    onEndDateChange() {
        if (!this.period.endDate) return;
        const end = this.parseDateString(this.period.endDate);
        const freq = (this.frequency || '').toLowerCase();

        if (this.period.startDate) {
            const start = this.parseDateString(this.period.startDate);
            if (end < start) {
                this.toastService.show('End Date cannot be earlier than Start Date.', 'error');
                this.period.endDate = '';
                return;
            }

            // Limit to 1 year (Mandatory for all)
            const limitDate = new Date(start);
            limitDate.setFullYear(limitDate.getFullYear() + 1);
            limitDate.setDate(limitDate.getDate() - 1);

            if (end > limitDate) {
                this.toastService.show('Period duration cannot exceed 1 year.', 'error');
                this.period.endDate = '';
                return;
            }
        }

        // Last Period End Date Validation (Global)
        // User now wants the header to reflect the last period's end date
        if (this.isLast && this.subscriptionEndDate && this.period.endDate !== this.subscriptionEndDate) {
             // We let the parent handle the synchronization via (productChanged)
        }

        this.validateAndUpdate();
    }

    private validateAndUpdate() {
        if (this.period.startDate && this.period.endDate) {
            this.updateDurationDays();
            this.productChanged.emit();
        }
    }

    toggleExpand() {
        this.period.isExpanded = !this.period.isExpanded;
    }

    onProductChange() {
        const selected = this.products.find(p => p.name.trim().toLowerCase() === this.period.productName.trim().toLowerCase());
        if (selected) {
            this.period.productCategory = selected.category;
            this.period.unitPrice = selected.price ?? null;
            this.period.unitPriceFrequency = selected.frequency;
            this.period.nonProdPrice = selected.nonProdPrice ?? null;
            this.period.productId = selected.productId;
            this.period.pricebookEntryId = selected.pricebookEntryId;
            (this.period as any).psmId = selected.psmId;

            const nonProdRow = this.period.userRows.find(r => r.type === 'Non-prod');
            if (nonProdRow) {
                nonProdRow.price = selected.nonProdPrice ?? 0;
                nonProdRow.frequency = selected.frequency;
                nonProdRow.name = selected.nonProdProductName || '';
                nonProdRow.productId = selected.nonProdProductId || '';
                nonProdRow.pricebookEntryId = selected.nonProdPricebookEntryId || '';
                nonProdRow.psmId = selected.nonProdPsmId || '';
            }
            this.productChanged.emit();
        }
    }

    togglePlatformDropdown() {
        this.platformDropdownOpen = !this.platformDropdownOpen;
    }

    selectPlatformProduct(product: ProductItem) {
        if (this.remainingQuota <= 0 && !this.period.productName) {
            this.toastService.show('Product catalog limit reached. Cannot select platform.', 'error');
            this.platformDropdownOpen = false;
            return;
        }
        this.period.productName = product.name;
        this.onProductChange();
        this.platformDropdownOpen = false;
    }


    toggleRegionDropdown(index: number) {
        if (this.activeRegionIndex === index) {
            this.activeRegionIndex = null;
        } else {
            this.activeRegionIndex = index;
        }
    }

    selectRegion(index: number, region: string) {
        this.period.userRows[index].region = region;
        this.activeRegionIndex = null;
        this.productChanged.emit();
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

    getDurationLabel(): string {
        return this.formatTermDisplay(this.period.startDate, this.period.endDate);
    }

    formatTermDisplay(startDate: string, endDate: string): string {
        if (!startDate || !endDate) return '';
        const start = this.parseDateString(startDate);
        const end = this.parseDateString(endDate);
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
        if (months > 0) res += `${months} Month${months > 1 ? 's' : ''} `;
        if (diffDays > 0) res += `${diffDays} Day${diffDays > 1 ? 's' : ''}`;
        return res.trim() || '0 Months';
    }

    calculateFractionalTerm(startDate: string, endDate: string): number {
        if (!startDate || !endDate) return 0;
        const start = this.parseDateString(startDate);
        const end = this.parseDateString(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

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

    private parseDateString(dateStr: string): Date {
        const parts = dateStr.split('-').map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    private toIsoDateString(date: Date): string {
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    restrictNumeric(event: KeyboardEvent) {
        const allowedKeys = ['Backspace', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'Delete', 'End', 'Home'];

        // Allow navigation keys and shortcuts (Ctrl/Cmd + A, C, V, X, Z)
        if (allowedKeys.includes(event.key) || event.ctrlKey || event.metaKey) {
            return;
        }

        // Block 'e', 'E', '+', '-' explicitly
        if (['e', 'E', '+', '-'].includes(event.key)) {
            event.preventDefault();
            return;
        }

        // Allow digits and at most one decimal point
        const isDigit = /[0-9]/.test(event.key);
        const isDot = event.key === '.';

        if (!isDigit && !isDot) {
            event.preventDefault();
        }

        // Prevent multiple dots
        if (isDot && (event.target as HTMLInputElement).value.includes('.')) {
            event.preventDefault();
        }
    }

    validateDiscount(event: any) {
        let value = event.target.value;
        if (value < 0) {
            this.period.discount = 0;
            event.target.value = 0;
        }
        else if (value > 100) {
            this.toastService.show('Discount cannot be more than 100%.', 'error');
            this.period.discount = null;
            event.target.value = '';
        }
        this.productChanged.emit();
    }

    validateRowDiscount(event: any, row: UserTypeRow) {
        let value = event.target.value;
        if (value < 0) {
            row.discount = 0;
            event.target.value = 0;
        }
        else if (value > 100) {
            this.toastService.show('Discount cannot be more than 100%.', 'error');
            row.discount = null;
            event.target.value = '';
        }
        this.productChanged.emit();
    }

    validateQuantity(event: any, row: UserTypeRow) {
        let value = event.target.value;
        const numValue = Number(value) || 0;
        
        // If quota is exhausted and we are trying to add a NEW product (quantity was 0 or null)
        if (this.remainingQuota <= 0 && numValue > (row.quantity || 0)) {
            this.toastService.show('Product catalog limit reached. Cannot add more products.', 'error');
            row.quantity = row.quantity || 0;
            event.target.value = row.quantity;
            return;
        }

        if (numValue < 0) {
            row.quantity = 0;
            event.target.value = 0;
        }
        this.productChanged.emit();
    }

    onBlurDiscount() {
        if (this.period.discount === null || this.period.discount === undefined) {
            this.period.discount = 0;
        }
        this.productChanged.emit();
    }

    onBlurRowDiscount(row: UserTypeRow) {
        if (row.discount === null || row.discount === undefined) {
            row.discount = 0;
        }
        this.productChanged.emit();
    }

    onBlurQuantity(row: UserTypeRow) {
        if (row.quantity === null || row.quantity === undefined) {
            row.quantity = 0;
        }
        this.productChanged.emit();
    }

    getErrorBackgroundColor(messageType: string): string {
        switch (messageType) {
            case 'error':
                return 'bg-red-50';
            case 'warning':
                return 'bg-yellow-50';
            case 'info':
                return 'bg-blue-50';
            default:
                return 'bg-gray-50';
        }
    }

    getErrorBorderColor(messageType: string): string {
        switch (messageType) {
            case 'error':
                return 'border-l-4 border-red-500';
            case 'warning':
                return 'border-l-4 border-yellow-500';
            case 'info':
                return 'border-l-4 border-blue-500';
            default:
                return 'border-l-4 border-gray-500';
        }
    }

    getErrorTextColor(messageType: string): string {
        switch (messageType) {
            case 'error':
                return 'text-red-700';
            case 'warning':
                return 'text-yellow-700';
            case 'info':
                return 'text-blue-700';
            default:
                return 'text-gray-700';
        }
    }

    getErrorIconColor(messageType: string): string {
        switch (messageType) {
            case 'error':
                return 'text-red-600';
            case 'warning':
                return 'text-yellow-600';
            case 'info':
                return 'text-blue-600';
            default:
                return 'text-gray-600';
        }
    }

    hasErrors(): boolean {
        return this.errors && this.errors.length > 0;
    }
}
