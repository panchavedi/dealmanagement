import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface QuoteData {
    opportunityId: string | null;
    opportunityName: string | null;
    accountId: string | null;
    accountName: string | null;
    website: string | null;
    pricebook2Id: string | null;
    quoteId: string | null;
    quoteName: string | null;
    primaryContactName: string | null;
    salesChannel: string | null;
    productName: string | null;
    productId: string | null;
    categoryId: string | null;
    products: Array<{ id: string, name: string, categoryId: string, quoteLineId?: string }> | null;
}

const EMPTY_QUOTE_DATA: QuoteData = {
    opportunityId: null,
    opportunityName: null,
    accountId: null,
    accountName: null,
    website: null,
    pricebook2Id: null,
    quoteId: null,
    quoteName: null,
    primaryContactName: null,
    salesChannel: null,
    productName: null,
    productId: null,
    categoryId: null,
    products: null
};

const SESSION_KEY = 'quote_data';

@Injectable({
    providedIn: 'root'
})
export class QuoteDataService {

    private loadFromSession(): QuoteData {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            return raw ? { ...EMPTY_QUOTE_DATA, ...JSON.parse(raw) } : { ...EMPTY_QUOTE_DATA };
        } catch {
            return { ...EMPTY_QUOTE_DATA };
        }
    }

    private quoteDataSubject = new BehaviorSubject<QuoteData>(this.loadFromSession());

    quoteData$ = this.quoteDataSubject.asObservable();

    setQuoteData(data: Partial<QuoteData>) {
        const currentData = this.quoteDataSubject.value;
        const updated = { ...currentData, ...data };
        this.quoteDataSubject.next(updated);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
    }

    getQuoteData(): QuoteData {
        return this.quoteDataSubject.value;
    }

    clearQuoteData() {
        this.quoteDataSubject.next({ ...EMPTY_QUOTE_DATA });
        sessionStorage.removeItem(SESSION_KEY);
    }
}
