import { Component, Input, Output, EventEmitter, OnInit, inject, HostListener, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DiscountsIncentivesComponent } from '../discounts-incentives/discounts-incentives.component';
import { GcpProductErrorsComponent } from '../gcp-product-errors/gcp-product-errors.component';
import { ToastService } from '../../services/toast.service';
import { QuoteDataService } from '../../services/quote-data.service';
import { ContextService } from '../../services/context.service';
import { SalesforceApiService } from '../../services/salesforce-api.service';
import { LoadingService } from '../../services/loading.service';
import { DiscountIncentiveStateService } from '../../services/discount-incentive-state.service';
import { Observable, of, from } from 'rxjs';
import { switchMap, map, concatMap, toArray } from 'rxjs/operators';

@Component({
  selector: 'app-commit-configuration',
  standalone: true,
  imports: [CommonModule, FormsModule, DiscountsIncentivesComponent, GcpProductErrorsComponent],
  templateUrl: './commit-configuration.component.html',
  styles: [`
    .custom-scrollbar::-webkit-scrollbar {
      width: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: #f1f5f9;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
  `]
})
export class CommitConfigurationComponent implements OnInit {
  private toastService = inject(ToastService);
  private quoteDataService = inject(QuoteDataService);
  private contextService = inject(ContextService);
  private sfApi = inject(SalesforceApiService);
  private loadingService = inject(LoadingService);
  private discountIncentiveStateService = inject(DiscountIncentiveStateService);

  @ViewChild(DiscountsIncentivesComponent) discountsIncentives?: DiscountsIncentivesComponent;

  @Input() productId: string = '';
  @Input() productName: string = 'Google Cloud Platform RCA';
  @Input() quoteLineId: string = '';
  @Input() accountName: string = '';
  @Input() quoteId: string = '';
  @Input() remainingQuota: number = 1000;
  
  activeTab: 'details' | 'discounts' = 'details';
  commitmentPeriods: any[] = [{ months: null, amount: null, isCollapsed: false }];
  activeMenuIndex: number | null = null;

  // Validation error state
  validationErrors: { message: string; messageType: string; category: string; relatedRecordId?: string }[] = [];
  hasValidationErrors: boolean = false;
  showErrorProductsPanel: boolean = false;
  errorProductItems: any[] = [];
  isDiscountErrorMode: boolean = true;

  @Output() validationMessagesReceived = new EventEmitter<{ productId: string; productName: string; messages: any[] }>();
  
  opportunityName: string = '';
  startDate: string = new Date().toLocaleDateString('en-CA');
  expirationDate: string = '';
  minDate: string = new Date().toLocaleDateString('en-CA');
  primaryContactName: string = '';
  salesChannel: string = '';

  /** Key is per-product so multiple products don't collide */
  private get sessionKey(): string {
    return `commit_config_${this.productId}`;
  }

  private saveToSession() {
    sessionStorage.setItem(this.sessionKey, JSON.stringify({
      commitmentPeriods: this.commitmentPeriods,
      startDate: this.startDate,
      activeTab: this.activeTab
    }));
  }

  private loadFromSession() {
    try {
      const raw = sessionStorage.getItem(this.sessionKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.commitmentPeriods && saved.commitmentPeriods.length > 0) {
          this.commitmentPeriods = saved.commitmentPeriods;
        }
        if (saved.startDate) this.startDate = saved.startDate;
        if (saved.activeTab) this.activeTab = saved.activeTab;
      }
    } catch { /* ignore */ }
  }

  get totalTerms(): number {
    return this.commitmentPeriods.reduce((acc, curr) => acc + (parseInt(curr.months || '0') || 0), 0);
  }

  get contractEndDate(): string {
    if (!this.startDate || !this.totalTerms) return '';
    const parts = this.startDate.split('-');
    const end = new Date(Number(parts[0]), Number(parts[1]) - 1 + this.totalTerms, Number(parts[2]));
    end.setDate(end.getDate() - 1); // last day of the term
    return this.toIsoDateString(end);
  }

  get totalContractValue(): number {
    return this.commitmentPeriods.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  }

  getPreviewData(previewData: any) {
    const commitments = this.buildPreviewCommitments(previewData);
    const productsWithoutDiscounts = this.buildProductsWithoutDiscounts(previewData);
    
    return {
      previewData: previewData,
      previewCommitments: commitments,
      previewProductsWithoutDiscounts: productsWithoutDiscounts,
      commitmentDetailsOnly: this.getCommitmentDetailsOnly(),
      isLookerSubscription: false,
      totalContractValue: this.totalContractValue,
      totalIncentivesValue: this.getTotalIncentivesValue(previewData),
      totalTerms: this.totalTerms,
      startDate: this.startDate,
      expirationDate: this.expirationDate
    };
  }

  private buildPreviewCommitments(previewData: any): any[] {
    const previews: any[] = [];
    if (!previewData?.QuoteLineItems?.records) return [];

    const matchedIds = new Set<string>();

    // 1. Process Discount Periods from child component or state service
    const state = this.discountIncentiveStateService.getCurrentState();
    const discountPeriods = this.discountsIncentives?.discountPeriods || state.discountPeriods || [];
    discountPeriods.forEach((period: any, index: number) => {
        const startDateStr = period.startDate;
        const endDateStr = period.endDate;
        const individualItems: any[] = [];
        const groupItems: any[] = [];

        if (startDateStr) {
            const pStart = new Date(startDateStr).getTime();
            let pEnd: number | null = null;
            if (endDateStr) pEnd = new Date(endDateStr).setHours(23, 59, 59, 999);

            previewData.QuoteLineItems.records.forEach((item: any) => {
                if (item.Id && matchedIds.has(item.Id)) return;
                if (item.Product2Id === this.productId) return; // Skip bundle

                const discount = item.Discount != null ? parseFloat(item.Discount) : 0;
                if (discount === 0) return;

                const itemStartStr = item.StartDate;
                if (itemStartStr) {
                    const itemStart = new Date(itemStartStr).getTime();
                    const dateMatches = pEnd ? (itemStart >= pStart && itemStart <= pEnd) : (itemStart >= pStart);
                    
                    if (dateMatches) {
                        if (item.Id) matchedIds.add(item.Id);
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
            type: 'discount',
            name: `Discount Period ${index + 1}`,
            displayName: `Discount Period ${index + 1}`,
            startDate: startDateStr ? this.formatDateForDisplay(startDateStr) : '',
            endDate: endDateStr ? this.formatDateForDisplay(endDateStr) : '',
            months: period.months,
            amount: period.amount,
            bulkIndividualItems: individualItems,
            groupItems,
        });
    });

    // 2. Process Incentive Periods
    const incentivePeriods = this.discountsIncentives?.incentivePeriods || [];
    incentivePeriods.forEach((period: any, index: number) => {
        const startDateStr = period.startDate;
        const endDateStr = period.endDate;
        const individualItems: any[] = [];
        const groupItems: any[] = [];

        if (startDateStr) {
            const pStart = new Date(startDateStr).getTime();
            let pEnd: number | null = null;
            if (endDateStr) pEnd = new Date(endDateStr).setHours(23, 59, 59, 999);

            previewData.QuoteLineItems.records.forEach((item: any) => {
                if (item.Id && matchedIds.has(item.Id)) return;
                const incentive = item.Incentive__c ? parseFloat(item.Incentive__c) : 0;
                if (incentive === 0) return;

                const itemStartStr = item.StartDate;
                if (itemStartStr) {
                    const itemStart = new Date(itemStartStr).getTime();
                    if (itemStart >= pStart && (pEnd ? itemStart <= pEnd : true)) {
                        if (item.Id) matchedIds.add(item.Id);
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
            type: 'incentive',
            name: `Incentive Period`,
            displayName: `Incentive Period`,
            startDate: startDateStr ? this.formatDateForDisplay(startDateStr) : '',
            endDate: endDateStr ? this.formatDateForDisplay(endDateStr) : '',
            months: period.months,
            amount: period.amount,
            bulkIndividualItems: individualItems,
            groupItems,
        });
    });

    return previews;
  }

  private buildProductsWithoutDiscounts(previewData: any): any[] {
    const products: any[] = [];
    if (!previewData?.QuoteLineItems?.records) return [];

    const bundle = previewData.QuoteLineItems.records.find((item: any) => item.Product2Id === this.productId);
    if (bundle) {
        products.push({
            ...bundle,
            Product_Name_Display: bundle.Product2?.Name || 'Product',
            Quantity: 1
        });
    }
    return products;
  }

  private getTotalIncentivesValue(previewData: any): number {
    if (!previewData?.QuoteLineItems?.records) return 0;
    return previewData.QuoteLineItems.records.reduce((acc: number, item: any) => acc + (Number(item.Incentive__c) || 0), 0);
  }

  private isGroupProduct(item: any): boolean {
    const family = item.Product2?.Family;
    return family === 'Product Group' || !family || family === 'Compute' || family === 'Storage';
  }

  formatDateForDisplay(dateString: any): string {
    if (!dateString) return '-';
    // Use UTC to avoid off-by-one errors from local timezone
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  }

  ngOnInit() {
    this.quoteDataService.quoteData$.subscribe(data => {
      if (data.opportunityName) this.opportunityName = data.opportunityName;
      if (data.accountName) this.accountName = data.accountName;
      if (data.quoteId) this.quoteId = data.quoteId;
      if (data.primaryContactName) this.primaryContactName = data.primaryContactName;
      if (data.salesChannel) this.salesChannel = data.salesChannel;
    });

    this.loadFromSession(); // Restore commitment periods and start date
    this.updateExpirationDate();
  }

  switchTab(tab: 'details' | 'discounts') {
    if (tab === 'discounts') {
        const hasValidPeriod = this.commitmentPeriods.some(p => p.months && p.amount);
        if (!hasValidPeriod) {
            this.toastService.show('Please provide at least one valid commitment period (Months and Amount) before proceeding.', 'warning');
            return;
        }
    }
    this.activeTab = tab;
    this.saveToSession();
  }

  addPeriod() {
    if (this.commitmentPeriods.length >= 5) {
      this.toastService.show('Maximum 5 commitment periods allowed.', 'warning');
      return;
    }
    const lastPeriod = this.commitmentPeriods[this.commitmentPeriods.length - 1];
    if (lastPeriod && (!lastPeriod.months || !lastPeriod.amount)) {
      this.toastService.show('Please fill the current commitment period details before adding a new one.', 'warning');
      return;
    }
    this.commitmentPeriods.push({ months: null, amount: null, isCollapsed: false });
    this.saveToSession();
  }

  removePeriod() {
    if (this.commitmentPeriods.length <= 1) return;
    this.commitmentPeriods.pop();
    this.saveToSession();
  }

  toggleEdit(index: number) {
    this.commitmentPeriods[index].isCollapsed = !this.commitmentPeriods[index].isCollapsed;
  }

  toggleMenu(index: number, event: Event) {
    event.stopPropagation();
    this.activeMenuIndex = this.activeMenuIndex === index ? null : index;
  }

  duplicatePeriod(index: number) {
    if (this.commitmentPeriods.length >= 5) return;
    const period = { ...this.commitmentPeriods[index], isCollapsed: true, isDuplicated: true };
    this.commitmentPeriods.splice(index + 1, 0, period);
    this.activeMenuIndex = null;
    this.saveToSession();
  }

  deletePeriod(index: number) {
    if (this.commitmentPeriods.length <= 1) return;
    this.commitmentPeriods.splice(index, 1);
    this.activeMenuIndex = null;
    this.saveToSession();
  }

  @HostListener('document:click')
  closeMenu() {
    this.activeMenuIndex = null;
  }

  getCommitmentDetailsOnly(): any[] {
    const details: any[] = [];
    const quoteStartDateStr = this.startDate || new Date().toISOString().split('T')[0];
    
    // Robust date parsing (handles YYYY-MM-DD or MM/DD/YYYY)
    let currentStartDate: Date;
    if (quoteStartDateStr.includes('-')) {
        const parts = quoteStartDateStr.split('-');
        currentStartDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
    } else if (quoteStartDateStr.includes('/')) {
        const parts = quoteStartDateStr.split('/');
        // Assuming MM/DD/YYYY if it starts with a small number, else YYYY/MM/DD
        if (parseInt(parts[0]) <= 12) {
            currentStartDate = new Date(Date.UTC(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1])));
        } else {
            currentStartDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
        }
    } else {
        currentStartDate = new Date(quoteStartDateStr);
    }

    if (isNaN(currentStartDate.getTime())) {
        currentStartDate = new Date();
        currentStartDate.setUTCHours(0, 0, 0, 0);
    }

    this.commitmentPeriods.forEach((period, index) => {
        const months = parseInt(String(period.months || '0')) || 0;
        const amount = Number(period.amount || 0) || 0;

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

            currentStartDate = new Date(endDate);
            currentStartDate.setUTCDate(currentStartDate.getUTCDate() + 1);
        }
    });
    return details;
  }

  private formatUTCDateForDisplay(date: Date): string {
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
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

  onMonthFocus(index: number, input: HTMLInputElement) {
    if (this.commitmentPeriods[index].months) {
      input.value = this.commitmentPeriods[index].months.toString();
    }
  }

  onMonthBlur(index: number, input: HTMLInputElement) {
    const val = input.value;
    this.commitmentPeriods[index].months = val.replace(/[^0-9]/g, '');
    this.updateExpirationDate();
    this.saveToSession();
  }

  onMonthInput(index: number, val: string) { }

  onAmountBlur(index: number, val: string) {
    this.commitmentPeriods[index].amount = this.parseShorthandValue(val);
    this.saveToSession();
  }

  parseShorthandValue(val: string): number {
    if (!val) return 0;

    let cleaned = val.toLowerCase().replace(/[^0-9.kmb]/g, '');
    if (!cleaned) return 0;

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
  }

  checkCollapse(index: number, event: any) {
    setTimeout(() => {
        const activeElem = document.activeElement;
        const container = event.currentTarget as HTMLElement;
        if (!container.contains(activeElem)) {
            if (this.commitmentPeriods[index].months && this.commitmentPeriods[index].amount) {
                this.commitmentPeriods[index].isCollapsed = true;
            }
        }
    }, 100);
  }

  updateExpirationDate() {
    if (this.startDate) {
      const date = new Date(this.startDate);
      date.setDate(date.getDate() + 45);
      this.expirationDate = this.toIsoDateString(date);
    }
  }

  toIsoDateString(date: Date): string {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  onSkipAndSave() {
    this.onSave();
  }

  clearValidationErrors() {
    this.validationErrors = [];
    this.hasValidationErrors = false;
  }

  private parseConfiguratorMessages(response: any): { errors: any[]; warnings: any[]; infos: any[]; all: any[]; hasMessages: boolean } {
    const errors: any[] = [];
    const warnings: any[] = [];
    const infos: any[] = [];
    const all: any[] = [];

    const messages = response?.configuratorMessages;
    if (!messages || typeof messages !== 'object') {
      return { errors, warnings, infos, all, hasMessages: false };
    }

    Object.keys(messages).forEach(key => {
      const msgArray = messages[key];
      if (!Array.isArray(msgArray)) return;

      msgArray.forEach((msg: any) => {
        const entry = {
          message: msg.message,
          messageType: msg.messageType || 'info',
          category: msg.category,
          primaryRecordId: msg.primaryRecordId,
          relatedRecordId: msg.relatedRecordId || key
        };

        all.push(entry);
        if (msg.messageType === 'error') {
          errors.push(entry);
        } else if (msg.messageType === 'warning') {
          warnings.push(entry);
        } else {
          infos.push(entry);
        }
      });
    });

    return { errors, warnings, infos, all, hasMessages: all.length > 0 };
  }

  openErrorProductsPanel(isDiscount: boolean = true) {
    this.isDiscountErrorMode = isDiscount;
    this.errorProductItems = this.getErrorProductItems(isDiscount);
    this.showErrorProductsPanel = true;
  }

  openFirstErrorProductsPanel() {
    const hasDiscountProducts = this.getDiscountErrorProductCount() > 0;
    const hasIncentiveProducts = this.getIncentiveErrorProductCount() > 0;
    this.openErrorProductsPanel(hasDiscountProducts || !hasIncentiveProducts);
  }

  getDiscountErrorProductCount(): number {
    return this.getErrorProductItems(true).length;
  }

  getIncentiveErrorProductCount(): number {
    return this.getErrorProductItems(false).length;
  }

  getDiscountErrorProductIds(): string[] {
    return this.getErrorProductItems(true).map(item => item.product2Id || item.id).filter(Boolean);
  }

  getIncentiveErrorProductIds(): string[] {
    return this.getErrorProductItems(false).map(item => item.product2Id || item.id).filter(Boolean);
  }

  private getErrorProductItems(isDiscount: boolean): any[] {
    // Build product items from the pending transactions for the error panel
    const quoteId = this.quoteId || this.contextService.currentContext?.quoteId || '';
    const pendingTransactions = this.discountIncentiveStateService.getPendingTransactions(quoteId);
    const items: any[] = [];

    pendingTransactions.forEach((tx: any, txIndex: number) => {
      const records = tx.graph?.records || [];
      records.forEach((rec: any, recIndex: number) => {
        const record = rec.record;
        if (record.attributes?.type === 'Quote') return;
        if (record.attributes?.type === 'QuoteLineItem') {
          const hasDiscount = record.Discount !== undefined;
          const hasIncentive = record.Incentive__c !== undefined;
          const matchesMode = isDiscount ? hasDiscount : hasIncentive;
          if (!matchesMode) return;

          // Find matching validation error for this product
          const productName = record.Product2?.Name ||
            record.ProductName ||
            record.Name ||
            this.discountsIncentives?.resolveProductDisplayName(record.Product2Id) ||
            record.Product2Id ||
            'Unknown Product';
          const nodeType = isDiscount ? 'Discount' : 'Incentive';
          const nodeId = `GCP_${nodeType}_Line_${txIndex}_${recIndex}`;
          const matchedErrors = this.validationErrors.filter(e => 
            e.message.toLowerCase().includes(productName.toLowerCase()) ||
            e.relatedRecordId === record.Product2Id ||
            e.relatedRecordId === rec.referenceId ||
            e.relatedRecordId === nodeId
          );
          if (matchedErrors.length === 0) return;

          const remarks = matchedErrors.map(e => e.message).join('\n');
          const messageType = matchedErrors[0]?.messageType || 'error';

          items.push({
            id: record.Product2Id || record.Id || `item_${Math.random().toString(36).substr(2, 9)}`,
            name: productName,
            product2Id: record.Product2Id,
            remarks,
            messageType,
            selected: false,
            value: isDiscount ? (record.Discount || 0) : (record.Incentive__c || ''),
            deleted: false
          });
        }
      });
    });

    return items;
  }

  closeErrorProductsPanel() {
    this.showErrorProductsPanel = false;
  }

  onErrorProductsSubmit(payload: any) {
    console.log('[CommitConfiguration] Error products update payload:', payload);
    this.discountIncentiveStateService.applyPendingTransactionChanges(
      this.quoteId || this.contextService.currentContext?.quoteId || '',
      payload.mode,
      payload.edits || [],
      payload.deletes || []
    );
    this.showErrorProductsPanel = false;
    this.toastService.show('Products updated. Click Save to re-submit.', 'info');
  }

  onSave(onSuccess?: () => void) {
    const fullQuoteId = this.quoteId || this.contextService.currentContext?.quoteId;
    const mappingId = this.contextService.quoteEntitiesMappingId;

    if (!fullQuoteId) {
      this.toastService.show('Quote ID not found', 'error');
      return;
    }

    if (!mappingId) {
      this.toastService.show('Context Mapping ID not found. Please reload the page.', 'error');
      return;
    }

    // Clear previous validation errors
    this.clearValidationErrors();

    this.loadingService.show();

    // 1. Build all Added Nodes
    const allAddedNodes = this.buildAddedNodes(fullQuoteId);
    
    // 2. Chunk nodes (e.g., 400 per batch)
    const chunks = this.chunkArray(allAddedNodes, 400);
    const contextIds: string[] = [];

    console.log(`[CommitConfiguration] Starting batched save for ${allAddedNodes.length} nodes in ${chunks.length} batches.`);

    // 3. Process batches sequentially: setInstance -> addNodes, checking for configurator messages
    from(chunks).pipe(
      concatMap((chunk, index) => {
        console.log(`[CommitConfiguration] Processing batch ${index + 1}/${chunks.length} (${chunk.length} nodes)`);
        return this.sfApi.setInstance(mappingId, fullQuoteId).pipe(
          switchMap((setRes: any) => {
            const contextId = setRes.contextId;
            if (!contextId) throw new Error(`Batch ${index + 1}: Failed to get contextId`);
            contextIds.push(contextId);
            return this.sfApi.addNodes(contextId, chunk).pipe(
              map((addNodesRes: any) => {
                // Check for configuratorMessages in each batch response
                const parsed = this.parseConfiguratorMessages(addNodesRes);
                console.log(`[CommitConfiguration] Batch ${index + 1} configurator messages:`, parsed);

                if (parsed.hasMessages) {
                  this.validationErrors = [...this.validationErrors, ...parsed.all.map(e => ({
                    message: e.message,
                    messageType: e.messageType,
                    category: e.category,
                    relatedRecordId: e.relatedRecordId
                  }))];
                  this.hasValidationErrors = true;

                  // Emit to parent for header validation panel
                  this.validationMessagesReceived.emit({
                    productId: this.productId || '',
                    productName: this.getActualProductNames(fullQuoteId),
                    messages: parsed.all
                  });

                  throw { isValidationError: true, message: 'Configurator messages found. Fix issues and try again.' };
                }

                return addNodesRes;
              })
            );
          })
        );
      }),
      toArray(), // Collect results of all addNodes calls
      switchMap(() => {
        // 4. Final Save Instance: Only if no validation errors
        console.log(`[CommitConfiguration] Saving ${contextIds.length} batches sequentially...`);
        return from(contextIds).pipe(
          concatMap(id => this.sfApi.saveInstance(id)),
          toArray() // Wait for all saves to finish
        );
      })
    ).subscribe({
      next: (res: any) => {
        this.discountIncentiveStateService.clearPendingTransactions(fullQuoteId);
        this.loadingService.hide();

        // Clear errors on successful save
        this.clearValidationErrors();
        this.validationMessagesReceived.emit({
          productId: this.productId || '',
          productName: this.getActualProductNames(fullQuoteId),
          messages: []
        });

        this.toastService.show('Configuration Saved Successfully!', 'success');
        if (onSuccess) onSuccess();
      },
      error: (err) => {
        this.loadingService.hide();

        // If it's a validation error we threw, don't show a generic error
        if (err?.isValidationError) {
          console.warn('[CommitConfiguration] Blocked by validation errors.');
          return;
        }

        console.error('[CommitConfiguration] Save Error:', err);
        this.toastService.show(err.message || 'Failed to save configuration.', 'error');
      }
    });
  }

  private chunkArray(array: any[], size: number): any[][] {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private buildAddedNodes(quoteId: string): any[] {
    const nodes: any[] = [];
    
    const parentPath = [quoteId, "GCP_Parent_Platform"];
    const parentProductId = this.productId || "01tDz00000Eah7vIAB";
    if (!parentProductId) {
      console.warn("[CommitConfiguration] Skipping parent product node: productId is null.");
    } else {
      nodes.push({
        "path": parentPath,
        "addedObject": {
          "id": "GCP_Parent_Platform",
          "SalesTransactionItemSource": "GCP_Parent_Platform",
          "PricebookEntry": "01uDz00000dvDfbIAE",
          "businessObjectType": "QuoteLineItem",
          "Quantity": 1,
          "ItemSortOrder": 1,
          "Product": parentProductId,
          "StartDate": this.startDate ? new Date(this.startDate).toISOString() : new Date().toISOString(),
          "EndDate": this.contractEndDate ? new Date(this.contractEndDate).toISOString() : new Date().toISOString(),
          "SalesTransactionItemParent": quoteId
        }
      });
    }

    // 2. Commitment Detail Nodes
    this.commitmentPeriods.forEach((period, index) => {
      const months = parseInt(period.months) || 0;
      const amount = Number(period.amount) || 0;
      if (months > 0) {
        nodes.push({
          "path": [...parentPath, `Commitment_Detail_${index}`],
          "addedObject": {
            "id": `Commitment_Detail_${index}`,
            "ParentReference": "GCP_Parent_Platform",
            "CommitmentName__c": `Commitment Period ${index + 1}`,
            "Quote__c": quoteId,
            "CommitmentPeriod__c": months,
            "CommitmentAmount__c": amount,
            "Start_Date__c": this.startDate,
            "End_Date__c": this.contractEndDate,
            "businessObjectType": "Commitment_Details__c",
            "QuoteLine__c": "GCP_Parent_Platform",
            "Sourceid__c": `Commitment_Detail_${index}`
          }
        });
      }
    });

    // 3. Extract Discount and Incentive Nodes from Pending Transactions
    // These were staged in the service when "Add Discount" or "Add Incentive" was clicked
    const pendingTransactions = this.discountIncentiveStateService.getPendingTransactions(quoteId);
    
    pendingTransactions.forEach((tx: any, txIndex: number) => {
      const records = tx.graph?.records || [];
      records.forEach((rec: any, recIndex: number) => {
        const record = rec.record;
        // Skip the Quote PATCH record
        if (record.attributes?.type === 'Quote') return;

        if (record.attributes?.type === 'QuoteLineItem') {
          const isIncentive = record.Incentive__c !== undefined;
          const nodeType = isIncentive ? 'Incentive' : 'Discount';
          const nodeId = `GCP_${nodeType}_Line_${txIndex}_${recIndex}`;
          
          // Defensive Check: Only add if we have Product and PricebookEntry
          if (!record.Product2Id || !record.PricebookEntryId) {
            console.warn(`[CommitConfiguration] Skipping ${nodeType} node ${nodeId} due to missing Product2Id or PricebookEntryId`, record);
            return;
          }

          const node: any = {
            "path": [quoteId, nodeId],
            "addedObject": {
              "id": nodeId,
              "SalesTransactionItemSource": nodeId,
              "PricebookEntry": record.PricebookEntryId,
              "businessObjectType": "QuoteLineItem",
              "Quantity": record.Quantity || 1,
              "Product": record.Product2Id,
              "SalesTransactionItemParent": quoteId,
              "StartDate": record.StartDate ? new Date(record.StartDate).toISOString() : null,
              "EndDate": record.EndDate ? new Date(record.EndDate).toISOString() : null,
              "PeriodBoundary": record.PeriodBoundary || "Anniversary",
              "ItemSortOrder": record.SortOrder || (2 + txIndex + recIndex)
            }
          };

          // Add discount or incentive specific field
          if (isIncentive) {
            node.addedObject["Incentive__c"] = record.Incentive__c;
          } else {
            node.addedObject["Discount"] = record.Discount;
            if (record.SubscriptionTerm) {
              node.addedObject["SubscriptionTerm"] = record.SubscriptionTerm;
            }
          }

          nodes.push(node);
        }
      });
    });

    return nodes;
  }

  private getActualProductNames(quoteId: string): string {
    const productNames = new Set<string>();
    const pendingTransactions = this.discountIncentiveStateService.getPendingTransactions(quoteId);

    pendingTransactions.forEach((tx: any) => {
      const records = tx.graph?.records || [];
      records.forEach((rec: any) => {
        const record = rec.record;
        if (record.attributes?.type === 'Quote' || record.attributes?.type !== 'QuoteLineItem') return;

        const productName = record.Product2?.Name ||
          record.ProductName ||
          record.Name ||
          this.discountsIncentives?.resolveProductDisplayName(record.Product2Id) ||
          record.Product2Id ||
          'Unknown Product';
        
        if (productName) {
          productNames.add(productName);
        }
      });
    });

    // Return comma-separated list of unique product names, or fall back to input productName
    return productNames.size > 0 ? Array.from(productNames).join(', ') : (this.productName || 'Google Cloud Platform RCA');
  }

  formatCurrency(value: any): string {
    if (value === null || value === undefined || value === '') return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
  }
}
