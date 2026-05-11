import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface DiscountPeriod {
  id: string;
  name: string;
  timePeriod: string;
  startDate: string;
  endDate: string;
  activeDiscounts: any[];
}

export interface IncentivePeriod {
  id: string;
  name: string;
  timePeriod: string;
  startDate: string;
  endDate: string;
  activeIncentives: any[];
}

export interface DiscountIncentiveState {
  // Form data
  discountForm: {
    granularity: string;
    type: string;
    priceReference: string;
    value: string;
    selectedItemsCount: number;
  };
  incentiveForm: {
    type: string;
    amount: string;
    currency: string;
    selectedItemsCount: number;
  };

  // Periods
  discountPeriods: DiscountPeriod[];
  incentivePeriods: IncentivePeriod[];
  activeDiscountPeriodId: string;
  activeIncentivePeriodId: string;

  // Active tab
  activeTab: 'discounts' | 'incentives';

  // Selection state (serialised as plain arrays for JSON)
  persistentSelectedGroups: Map<string, any>;
  persistentSelectedIndividuals: Map<string, any>;
  persistentIncentiveGroups: Map<string, any>;
  bulkUploadedProductIds: Set<string>;

  // Product data
  productGroups: any[];
  individualProducts: any[];
  dropdownOptions: any[];
  selectedDropdownOption: any;
  quoteId?: string;
  
  // Pending API calls to execute on Save
  pendingTransactions: any[];
}

const SESSION_KEY = 'discount_incentive_state';

@Injectable({
  providedIn: 'root'
})
export class DiscountIncentiveStateService {
  private stateSubject = new BehaviorSubject<DiscountIncentiveState | null>(null);
  public state$ = this.stateSubject.asObservable();

  private getDefaultState(): DiscountIncentiveState {
    return {
      discountForm: {
        granularity: 'Select',
        type: 'Flat rate (%)',
        priceReference: 'Select',
        value: '',
        selectedItemsCount: 0
      },
      incentiveForm: {
        type: 'Select',
        amount: '',
        currency: 'USD',
        selectedItemsCount: 0
      },
      discountPeriods: [
        {
          id: '1',
          name: 'Discount Period 1',
          timePeriod: 'Date range',
          startDate: '',
          endDate: '',
          activeDiscounts: []
        }
      ],
      incentivePeriods: [
        {
          id: '1',
          name: 'Incentives',
          timePeriod: 'Date range',
          startDate: '',
          endDate: '',
          activeIncentives: []
        }
      ],
      activeDiscountPeriodId: '1',
      activeIncentivePeriodId: '1',
      activeTab: 'discounts',
      persistentSelectedGroups: new Map(),
      persistentSelectedIndividuals: new Map(),
      persistentIncentiveGroups: new Map(),
      bulkUploadedProductIds: new Set(),
      productGroups: [],
      individualProducts: [],
      dropdownOptions: [],
      selectedDropdownOption: null,
      pendingTransactions: []
    };
  }

  /** Serialise state to JSON-safe object (Maps → arrays, Sets → arrays) */
  private serialise(state: DiscountIncentiveState): object {
    return {
      ...state,
      persistentSelectedGroups: Array.from(state.persistentSelectedGroups?.entries() || []),
      persistentSelectedIndividuals: Array.from(state.persistentSelectedIndividuals?.entries() || []),
      persistentIncentiveGroups: Array.from(state.persistentIncentiveGroups?.entries() || []),
      bulkUploadedProductIds: Array.from(state.bulkUploadedProductIds || [])
    };
  }

  /** Deserialise JSON-safe object back to state with Maps/Sets */
  private deserialise(raw: any): DiscountIncentiveState {
    return {
      ...this.getDefaultState(),
      ...raw,
      persistentSelectedGroups: new Map(raw.persistentSelectedGroups || []),
      persistentSelectedIndividuals: new Map(raw.persistentSelectedIndividuals || []),
      persistentIncentiveGroups: new Map(raw.persistentIncentiveGroups || []),
      bulkUploadedProductIds: new Set(raw.bulkUploadedProductIds || [])
    };
  }

  private loadFromSession(): DiscountIncentiveState | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        return this.deserialise(JSON.parse(raw));
      }
    } catch (e) {
      console.warn('Failed to load discount/incentive state from session', e);
      sessionStorage.removeItem(SESSION_KEY);
    }
    return null;
  }

  private saveToSession(state: DiscountIncentiveState) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.serialise(state)));
    } catch (e) {
      console.warn('Failed to save discount/incentive state to session', e);
    }
  }

  saveState(state: Partial<DiscountIncentiveState>, quoteId?: string) {
    const currentState = this.loadFromSession() || this.getDefaultState();

    // If quoteId changes, clear state first
    if (quoteId && currentState.quoteId && currentState.quoteId !== quoteId) {
      this.clearState();
      const newState = { ...this.getDefaultState(), ...state, quoteId } as DiscountIncentiveState;
      this.saveToSession(newState);
      this.stateSubject.next(newState);
      return;
    }

    const newState = { ...currentState, ...state } as DiscountIncentiveState;
    if (quoteId) newState.quoteId = quoteId;

    this.saveToSession(newState);
    this.stateSubject.next(newState);
  }

  loadState(quoteId?: string): DiscountIncentiveState {
    const fromSession = this.loadFromSession();

    // If quoteId changed, clear and return default
    if (quoteId && fromSession?.quoteId && fromSession.quoteId !== quoteId) {
      this.clearState();
      const defaultState = this.getDefaultState();
      defaultState.quoteId = quoteId;
      return defaultState;
    }

    if (fromSession) {
      if (quoteId && !fromSession.quoteId) fromSession.quoteId = quoteId;
      this.stateSubject.next(fromSession);
      return fromSession;
    }

    const defaultState = this.getDefaultState();
    if (quoteId) defaultState.quoteId = quoteId;
    this.stateSubject.next(defaultState);
    return defaultState;
  }

  clearState() {
    sessionStorage.removeItem(SESSION_KEY);
    const defaultState = this.getDefaultState();
    this.stateSubject.next(defaultState);
  }

  getCurrentState(): DiscountIncentiveState {
    return this.loadFromSession() || this.loadState();
  }

  public addPendingTransaction(transactionPayload: any, quoteId?: string) {
    const currentState = this.getCurrentState();
    currentState.pendingTransactions = currentState.pendingTransactions || [];
    currentState.pendingTransactions.push(transactionPayload);
    this.saveState(currentState, quoteId);
  }

  public getPendingTransactions(quoteId?: string): any[] {
    const currentState = this.loadState(quoteId);
    return currentState.pendingTransactions || [];
  }

  public clearPendingTransactions(quoteId?: string) {
    const currentState = this.loadState(quoteId);
    currentState.pendingTransactions = [];
    this.saveState(currentState, quoteId);
  }

  public updatePendingTransactionItems(quoteId: string | undefined, mode: string, updatedItems: any[]) {
    const edits = (updatedItems || [])
      .filter(item => !item.deleted)
      .map(item => ({ id: item.id, value: item.value, type: mode }));
    const deletes = (updatedItems || [])
      .filter(item => item.deleted)
      .map(item => ({ id: item.id }));

    this.applyPendingTransactionChanges(quoteId, mode, edits, deletes);
  }

  public applyPendingTransactionChanges(quoteId: string | undefined, mode: string, edits: any[], deletes: any[]) {
    const currentState = this.loadState(quoteId);
    const editMap = new Map((edits || []).map((edit: any) => [edit.id, edit]));
    const deleteIds = new Set((deletes || []).map((item: any) => item.id));
    const isDiscount = mode === 'discount';

    currentState.pendingTransactions = (currentState.pendingTransactions || []).map((tx: any) => {
      const records = tx.graph?.records || [];

      tx.graph.records = records.filter((rec: any) => {
        const record = rec.record || {};
        const recordId = record.Product2Id || record.Id || rec.referenceId;
        const matchesMode = isDiscount ? record.Discount !== undefined : record.Incentive__c !== undefined;

        if (!matchesMode || !recordId) return true;
        if (deleteIds.has(recordId)) return false;

        const edit = editMap.get(recordId);
        if (edit) {
          if (isDiscount) {
            record.Discount = Number(edit.value) || 0;
          } else {
            record.Incentive__c = edit.value;
          }
        }

        return true;
      });

      return tx;
    });

    this.saveState(currentState, quoteId);
  }
}
