import { Component, OnInit, HostListener, inject, ViewChild, ViewChildren, QueryList } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { QuoteDataService } from '../../services/quote-data.service';
import { TopNavComponent } from '../../components/top-nav/top-nav.component';
import { DetailsOfQuoteComponent } from '../../components/details-of-quote/details-of-quote.component';
import { CommitConfigurationComponent } from '../../components/commit-configuration/commit-configuration.component';
import { SubscriptionConfigurationComponent } from '../../components/subscription-configuration/subscription-configuration.component';
import { QuotePreviewComponent } from '../../components/quote-preview/quote-preview.component';
import { CartService } from '../../services/cart.service';
import { SalesforceApiService } from '../../services/salesforce-api.service';
import { LoadingService } from '../../services/loading.service';
import { ToastService } from '../../services/toast.service';
import { ContextService } from '../../services/context.service';
import { finalize, take, map, tap, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-quote-configuration',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TopNavComponent,
    DetailsOfQuoteComponent,
    CommitConfigurationComponent,
    SubscriptionConfigurationComponent,
    QuotePreviewComponent
  ],
  templateUrl: './quote-configuration.component.html',
  styles: [`
    .glass-card {
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.3);
    }
    .custom-scrollbar::-webkit-scrollbar {
      width: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }
  `]
})
export class QuoteConfigurationComponent implements OnInit {
  @ViewChild(DetailsOfQuoteComponent) detailsComp?: DetailsOfQuoteComponent;
  @ViewChildren(CommitConfigurationComponent) commitComps!: QueryList<CommitConfigurationComponent>;
  @ViewChildren(SubscriptionConfigurationComponent) subComps!: QueryList<SubscriptionConfigurationComponent>;
  @ViewChild(QuotePreviewComponent) previewComp?: QuotePreviewComponent;

  private quoteDataService = inject(QuoteDataService);
  private router = inject(Router);
  private sfApi = inject(SalesforceApiService);
  private loadingService = inject(LoadingService);
  private toastService = inject(ToastService);
  private contextService = inject(ContextService);
  private activatedRoute = inject(ActivatedRoute);
  private cartService = inject(CartService);

  isLoading = true;
  accountName = '';
  opportunityName = '';
  quoteName = '';
  quoteId = '';
  opportunityId = '';

  products: any[] = [];
  selectedItemId = sessionStorage.getItem('qc_selected_item') || 'quote_details';
  isEditingName = false;
  annualContractValue = 0;
  isPrimary = false;

  // Track validation errors per product for sidebar highlighting
  productValidationErrors: Map<string, any[]> = new Map();

  // Header validation panel state
  hasValidationErrors: boolean = false;
  validationPanelOpen: boolean = false;
  submittedErrorMessages: { productId: string; productName: string; message: string; messageType?: string; category?: string }[] = [];

  get groupedValidationMessages(): { productName: string; messages: { message: string; messageType: string }[] }[] {
    const grouped = new Map<string, { message: string; messageType: string }[]>();
    this.submittedErrorMessages.forEach(item => {
      const key = item.productName || item.productId || 'Product';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push({ message: item.message, messageType: item.messageType || 'info' });
    });
    return Array.from(grouped.entries()).map(([productName, messages]) => ({ productName, messages }));
  }

  togglePrimary(event: any) {
    const isChecked = event.target.checked;
    this.isPrimary = isChecked;

    const opportunityId = this.opportunityId;
    const quoteId = isChecked ? this.quoteId : null;

    if (!opportunityId || (isChecked && !quoteId)) {
      this.toastService.show('Opportunity ID or Quote ID missing.', 'error');
      this.isPrimary = !isChecked;
      return;
    }

    this.loadingService.show();
    this.sfApi.syncQuoteToOpportunity(opportunityId, quoteId).pipe(
      finalize(() => this.loadingService.hide())
    ).subscribe({
      next: (res) => {
        const action = isChecked ? 'synced to' : 'unsynced from';
        this.toastService.show(`Quote ${action} Opportunity successfully.`, 'success');
      },
      error: (err) => {
        console.error('Sync Error:', err);
        this.isPrimary = !isChecked;
      }
    });
  }

  get totalContractValue(): number {
    let sum = 0;
    if (this.commitComps) {
      this.commitComps.forEach(c => sum += c.totalContractValue || 0);
    }
    if (this.subComps) {
      this.subComps.forEach(s => sum += s.totalContractValue || 0);
    }
    return sum;
  }

  totalCatalogProducts: number = 1000;

  get usedQuotaCount(): number {
    // 1. Initial count includes every main product added to the cart
    let count = this.products ? this.products.length : 0;

    // 2. Extra products selected in Commit (via Discounts/Incentives selections)
    if (this.commitComps) {
      this.commitComps.forEach(commit => {
        if (commit.discountsIncentives) {
          // Count current selections (in progress)
          count += (commit.discountsIncentives.persistentSelectedGroups?.size || 0);
          count += (commit.discountsIncentives.persistentSelectedIndividuals?.size || 0);
          count += (commit.discountsIncentives.persistentIncentiveGroups?.size || 0);

          // Count already applied discounts
          commit.discountsIncentives.discountPeriods.forEach((p: any) => {
            if (p.activeDiscounts) {
              p.activeDiscounts.forEach((d: any) => count += (d.itemCount || 0));
            }
          });

          // Count already applied incentives
          commit.discountsIncentives.incentivePeriods.forEach((p: any) => {
            if (p.activeIncentives) {
              p.activeIncentives.forEach((i: any) => count += (i.itemCount || 0));
            }
          });
        }
      });
    }

    // 3. Subscription selections (Platform product + User quantities)
    if (this.subComps) {
      this.subComps.forEach(sub => {
        if (sub.subscriptionPeriods && sub.subscriptionPeriods.length > 0) {
          const firstPeriod = sub.subscriptionPeriods[0];

          // 3a. Count the Platform selection from the picklist if it's set
          if (firstPeriod.productName) {
            // Check if this specific product ID is already in our main products list to avoid double counting
            const isMainProduct = this.products.some(p => p.id === firstPeriod.productId || p.name === firstPeriod.productName);
            if (!isMainProduct) {
              count++;
            }
          }

          // 3b. Count each active user category
          if (firstPeriod.userRows) {
            firstPeriod.userRows.forEach((row: any) => {
              if ((row.quantity || 0) > 0) {
                count++;
              }
            });
          }
        }
      });
    }

    return count;
  }

  get remainingProductsQuota(): number {
    return Math.max(0, this.totalCatalogProducts - this.usedQuotaCount);
  }

  activeTab = 'details';

  get isSaveDisabled(): boolean {
    const type = this.getProductType(this.selectedItemId);
    if (type === 'commitment') {
      const comp = this.commitComps?.find(c => c.productId === this.selectedItemId);
      return comp?.activeTab !== 'discounts';
    }
    if (type === 'subscription') {
      const comp = this.subComps?.find(c => c.productId === this.selectedItemId);
      return comp?.activeTab !== 'plans';
    }
    return false; // Quote details
  }

  get isSubmitDisabled(): boolean {
    const type = this.getProductType(this.selectedItemId);
    if (type === 'commitment') {
      const comp = this.commitComps?.find(c => c.productId === this.selectedItemId);
      return comp?.activeTab !== 'discounts';
    }
    if (type === 'subscription') {
      const comp = this.subComps?.find(c => c.productId === this.selectedItemId);
      return comp?.activeTab !== 'plans';
    }
    return true; // Quote details
  }

  previewState: any = {
    show: false,
    data: null,
    commitments: [],
    products: [],
    isLooker: false,
    tcv: 0,
    incentives: 0,
    terms: 0,
    startDate: '',
    expirationDate: ''
  };

  openPreview() {
    if (this.selectedItemId === 'quote_details') {
      this.toastService.show('Please select a product to preview.', 'warning');
      return;
    }

    const qid = this.quoteId || this.contextService.currentContext?.quoteId;
    if (!qid) {
      this.toastService.show('Quote ID not found.', 'error');
      return;
    }

    this.loadingService.show();
    this.sfApi.getQuotePreview(qid).pipe(
      finalize(() => this.loadingService.hide())
    ).subscribe({
      next: (previewData: any) => {
        console.log('Preview data received:', previewData);
        if (previewData && previewData.records && previewData.records.length > 0) {
          const quote = previewData.records[0];
          const type = this.getProductType(this.selectedItemId);

          let pData: any = null;
          try {
            if (type === 'commitment') {
              const comp = this.commitComps?.find(c => c.productId === this.selectedItemId);
              if (comp) pData = comp.getPreviewData(quote);
            } else if (type === 'subscription') {
              const comp = this.subComps?.find(c => c.productId === this.selectedItemId);
              if (comp) pData = comp.getPreviewData(quote);
            }
          } catch (e) {
            console.error('Error building preview data:', e);
            this.toastService.show('Error preparing preview details.', 'error');
          }

          if (pData) {
            this.previewState = {
              show: true,
              data: quote,
              previewCommitments: pData.previewCommitments,
              commitmentDetailsOnly: pData.commitmentDetailsOnly || pData.commitmentDetailsSummary || [],
              previewProductsWithoutDiscounts: pData.previewProductsWithoutDiscounts,
              isLooker: pData.isLookerSubscription,
              tcv: pData.totalContractValue,
              incentives: pData.totalIncentivesValue,
              terms: pData.totalTerms,
              startDate: pData.startDate,
              expirationDate: pData.expirationDate
            };
          } else {
            this.toastService.show('No preview data available for this selection.', 'warning');
          }
        } else {
          this.toastService.show('No quote records found.', 'warning');
        }
      },
      error: (err: any) => {
        this.toastService.show('Failed to load quote preview.', 'error');
        console.error('Preview error:', err);
      }
    });
  }

  closePreview() {
    this.previewState.show = false;
  }

  resetForm() {
    this.router.navigate(['/']);
  }

  onSkipAndSave() {
    this.saveCurrentTab(() => {
      // Submit logic: show success or navigate
    });
  }

  onSave() {
    const saveQueue: ((next: () => void) => void)[] = [];

    // 1. Details
    if (this.detailsComp) {
      saveQueue.push((next) => {
        console.log('Initiating Quote Details Save');
        this.detailsComp!.onSave(next);
      });
    }

    // 2. Commitments (which includes its own sequential execution of Discounts & Incentives)
    if (this.commitComps && this.commitComps.length > 0) {
      this.commitComps.forEach((comp, index) => {
        saveQueue.push((next) => {
          console.log(`Initiating Commitment Save ${index + 1}`);
          comp.onSave(next);
        });
      });
    }

    // 3. Subscriptions (Looker Product)
    if (this.subComps && this.subComps.length > 0) {
      this.subComps.forEach((comp, index) => {
        saveQueue.push((next) => {
          console.log(`Initiating Subscription Save ${index + 1}`);
          // Skip the success feedback for intermediate steps to avoid too many toasts
          comp.onSave(next, true);
        });
      });
    }

    // Execute queue sequentially
    const executeNext = (index: number) => {
      if (index < saveQueue.length) {
        saveQueue[index](() => executeNext(index + 1));
      } else {
        // Done
        this.toastService.show('All configurations saved successfully!', 'success');
      }
    };

    if (saveQueue.length > 0) {
      executeNext(0);
    }
  }

  private saveCurrentTab(onSuccess?: () => void) {
    if (this.selectedItemId === 'quote_details') {
      this.detailsComp?.onSave(onSuccess);
    } else {
      const type = this.getProductType(this.selectedItemId);
      if (type === 'commitment') {
        const comp = this.commitComps?.find(c => c.productId === this.selectedItemId);
        comp?.onSave(onSuccess);
      } else if (type === 'subscription') {
        const comp = this.subComps?.find(c => c.productId === this.selectedItemId);
        comp?.onSave(onSuccess, false);
      }
    }
  }

  ngOnInit() {
    const mode = this.activatedRoute.snapshot.data['mode'] || 'configure';
    mode === 'edit' ? this.modifyQuote() : this.configureQuote();
  }

  private configureQuote() {
    this.isLoading = true;
    this.quoteId = this.contextService.currentContext?.quoteId || '';

    this.quoteDataService.quoteData$
      .pipe(
        finalize(() => (this.isLoading = false))
      )
      .subscribe({
        next: (data) => this.applyQuoteData(data),
        error: (err) => this.handleError('Error configuring quote', err)
      });
  }

  private modifyQuote() {
    this.quoteId =
      this.contextService.currentContext?.quoteId ??
      this.quoteDataService.getQuoteData()?.quoteId ?? '';

    if (!this.quoteId) {
      this.handleError('Quote ID not found');
      return;
    }

    this.isLoading = true;
    this.loadingService.show();

    this.sfApi.loadConfiguratorInstance(this.quoteId).pipe(
      take(1),
      switchMap((loadRes: any) => {
        const contextId = loadRes.contextId;
        if (!contextId) throw new Error('No contextId received from load-instance');
        return this.sfApi.getConfiguratorInstance(contextId);
      }),
      map((instanceRes: any) => {
        const records = instanceRes.instance?.records || [];
        const transactionRecord = instanceRes.transaction?.SalesTransaction?.[0];
        const quoteRecord = records.find((r: any) => r.attributes?.type === 'Quote') || transactionRecord;

        const salesTransactionName = instanceRes.SalesTransactionName ||
          instanceRes.instance?.SalesTransactionName ||
          instanceRes.quote?.SalesTransactionName ||
          transactionRecord?.SalesTransactionName ||
          quoteRecord?.SalesTransactionName ||
          quoteRecord?.Name ||
          instanceRes.quote?.Name ||
          instanceRes.Name;

        return {
          quoteId: quoteRecord?.id || quoteRecord?.Id,
          quoteName: salesTransactionName,
          products: records.filter((r: any) => r.attributes?.type === 'QuoteLineItem').map((r: any) => ({
            id: r.Product2Id,
            name: r.Name || r.Product2?.Name,
            quoteLineId: r.Id,
            categoryId: r.categoryId ?? ''
          }))
        };
      }),
      tap((mappedData) => {
        const existing = this.quoteDataService.getQuoteData();

        // Merge products to avoid losing locally added items that aren't yet in Salesforce records
        const existingProducts = existing.products || [];
        const newProducts = mappedData.products || [];

        const productMap = new Map();
        existingProducts.forEach((p: any) => productMap.set(p.id, p));
        newProducts.forEach((p: any) => productMap.set(p.id, p));

        const mergedProducts = Array.from(productMap.values());

        this.quoteDataService.setQuoteData({
          ...existing,
          ...mappedData,
          products: mergedProducts
        });
      }),
      finalize(() => {
        this.loadingService.hide();
        this.isLoading = false;
      })
    )
      .subscribe({
        next: (mappedData) => this.applyQuoteData(mappedData),
        error: (err) => this.handleError('Failed to load quote products', err)
      });
  }

  applyQuoteData(data: any) {
    if (!data) return;

    // Use nullish coalescing to preserve existing values if the new data doesn't have them
    this.accountName = data.accountName || this.accountName || 'Acme Corp';
    this.opportunityName = data.opportunityName || this.opportunityName || 'Expansion Deal';
    this.opportunityId = data.opportunityId || this.opportunityId || '';

    // Explicitly check for quoteName in data, then fall back to current value, then to 'Q-'
    if (data.quoteName) {
      this.quoteName = data.quoteName;
    } else if (!this.quoteName) {
      this.quoteName = 'Q-';
    }

    if (data.quoteId) this.quoteId = data.quoteId;

    if (data.products && data.products.length > 0) {
      this.products = data.products.map((p: any) => {
        const isLooker = p.name ? p.name.toLowerCase().includes('looker') : false;
        return {
          id: p.id,
          name: p.name,
          icon: isLooker ? 'bar_chart' : 'cloud',
          type: isLooker ? 'subscription' : 'commitment',
          quoteLineId: p.quoteLineId,
          categoryId: p.categoryId
        };
      });
    } else if (data.productId || data.productName) {
      const isLooker = data.productName?.toLowerCase().includes('looker');
      this.products = [{
        id: data.productId || 'p1',
        name: data.productName || 'Product',
        icon: isLooker ? 'bar_chart' : 'cloud',
        type: isLooker ? 'subscription' : 'commitment',
        categoryId: data.categoryId || ''
      }];
    }
  }

  private handleError(message: string, error?: any) {
    if (error) console.error(message, error);
    this.toastService.show(message, 'error');
    this.loadingService.hide();
    this.isLoading = false;
  }

  getProductType(id: string) {
    const p = this.products.find(p => p.id === id);
    return p ? p.type : 'none';
  }

  getSelectedProduct() {
    return this.products.find(p => p.id === this.selectedItemId);
  }

  selectItem(id: string) {
    this.selectedItemId = id;
    sessionStorage.setItem('qc_selected_item', id);
    if (id === 'quote_details') {
      this.activeTab = 'details';
    } else {
      this.activeTab = 'configuration';
    }
  }

  onAddProduct() {
    this.cartService.clearCart();
    this.router.navigate(['/products']);
  }

  formatCurrency(val: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  }

  // --- Validation Error Handling ---

  toggleValidationPanel(event?: Event) {
    if (event) event.stopPropagation();
    this.validationPanelOpen = !this.validationPanelOpen;
  }

  @HostListener('document:click')
  onDocumentClick() {
    // Close validation panel when clicking anywhere outside
    if (this.validationPanelOpen) {
      this.validationPanelOpen = false;
    }
  }

  onValidationMessagesReceived(event: { productId: string; productName: string; messages: any[] }) {
    if (event.messages && event.messages.length > 0) {
      this.productValidationErrors.set(event.productId, event.messages);

      // Build flat list of error messages for the header panel
      // First remove old errors for this product, then add new ones
      this.submittedErrorMessages = this.submittedErrorMessages.filter(m => m.productId !== event.productId);
      event.messages.forEach(msg => {
        this.submittedErrorMessages.push({
          productId: event.productId,
          productName: event.productName,
          message: msg.message,
          messageType: msg.messageType || 'info',
          category: msg.category
        });
      });

      this.hasValidationErrors = true;
      this.validationPanelOpen = true;
    } else {
      // Clear errors for this product
      this.productValidationErrors.delete(event.productId);
      this.submittedErrorMessages = this.submittedErrorMessages.filter(m => m.productId !== event.productId);

      // Check if any products still have errors
      this.hasValidationErrors = this.submittedErrorMessages.length > 0;
      if (!this.hasValidationErrors) {
        this.validationPanelOpen = false;
      }
    }
  }

  hasProductErrors(productId: string): boolean {
    return this.productValidationErrors.has(productId) &&
      (this.productValidationErrors.get(productId)?.length || 0) > 0;
  }

  getProductErrors(productId: string): any[] {
    return this.productValidationErrors.get(productId) || [];
  }
}
