import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpBackend } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, map, of, tap } from 'rxjs';
import { LoggingService } from './logging.service';

declare global {
    interface Window {
        SF_CONTEXT: any;
    }
}

@Injectable({
    providedIn: 'root'
})
export class ContextService {
    private contextSubject = new BehaviorSubject<any>(this.getInitialContext());
    public context$ = this.contextSubject.asObservable();

    private httpBackend = inject(HttpBackend);
    private loggingService = inject(LoggingService);
    private http: HttpClient;

    public quoteEntitiesMappingId: string | null = null;

    constructor() {
        this.http = new HttpClient(this.httpBackend); // Bypass interceptors for this specific client
        // Listen for data from the Salesforce Bridge
        window.addEventListener('sfcontextready', () => {
            if (window.SF_CONTEXT) {
                this.contextSubject.next(window.SF_CONTEXT);
                this.fetchMappingId();
            }
        });

        if (window.SF_CONTEXT) {
            this.contextSubject.next(window.SF_CONTEXT);
            this.fetchMappingId();
        }

        // Check availability of token on init
        if (!this.accessToken) {
            this.fetchSessionToken().subscribe(() => {
                this.fetchMappingId();
            });
        } else {
            this.fetchMappingId();
        }
    }

    /**
     * Fetches the ContextMapping ID for QuoteEntitiesMapping
     */
    private fetchMappingId() {
        if (!this.accessToken || this.quoteEntitiesMappingId) return;

        const baseUrl = this.apiBaseUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com';
        const query = "SELECT Id,Title,ContextDefinitionVersionId,IsDefault,CreatedDate FROM ContextMapping WHERE Title='QuoteEntitiesMapping' AND ContextDefinitionVersionId='11pDz000000000LIAQ'";
        const url = `${baseUrl}/services/data/v60.0/query/?q=${encodeURIComponent(query)}`;

        const headers = {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
        };

        this.http.get(url, { headers }).pipe(
            map((res: any) => (res.records && res.records.length > 0) ? res.records[0].Id : null),
            catchError(err => {
                console.error('Error fetching ContextMapping ID:', err);
                return of(null);
            })
        ).subscribe(id => {
            this.quoteEntitiesMappingId = id;
            console.log('✅ ContextService: QuoteEntitiesMapping ID stored:', id);
        });
    }

    private getInitialContext() {
        if (window.SF_CONTEXT) return window.SF_CONTEXT;

        // Check for token from PKCE Auth (sessionStorage - primary)
        const pkceToken = sessionStorage.getItem('access_token');
        const pkceInstanceUrl = sessionStorage.getItem('instance_url');

        if (pkceToken) {
            return {
                accessToken: pkceToken || '00DDz000001qvYA!ARQAQER0C3cGBYvJGp7BBz28NEzcAHqcboDupE4rLEXodf9SsjC7zJHnZRPgyBm5034L_FzvsWx2JU53QlJijbws914HYiNB',
                apiBaseUrl: pkceInstanceUrl || 'https://vector--rcaagivant.sandbox.my.salesforce.com',
                // Partial mock context still needed for other fields
                opportunityId: '006Dz00000Q82nrIAB', // Defaulting to one of the valid IDs from user log
                accountId: '001Dz00002vMgAfIAK',
                accountName: 'Pacifica Retail Group Pty Ltd',
                opportunityName: 'PRG Opprtunity',
                isGCPFamily: true,
                salesChannel: 'Partner',
                primaryContactName: 'Yin Jye Lee'
            };
        }

        // Check for token from OAuthService (Login Flow - localStorage fallback)
        const storedToken = localStorage.getItem('sf_access_token');
        const storedInstanceUrl = localStorage.getItem('sf_instance_url');

        if (storedToken) {
            return {
                accessToken: storedToken,
                apiBaseUrl: storedInstanceUrl,
                // Partial mock context still needed for other fields
                opportunityId: '006Dz00000Q82nrIAB', // Defaulting to one of the valid IDs from user log
                accountId: '001Dz00002vMgAfIAK',
                accountName: 'Pacifica Retail Group Pty Ltd',
                opportunityName: 'PRG Opprtunity',
                isGCPFamily: true,
                salesChannel: 'Partner',
                primaryContactName: 'Yin Jye Lee'
            };
        }

        // Mock Data for Local Development (Fallback)
        return {
            accessToken: '00DDz000001qvYA!ARQAQI6ooYUUPJ8BAdL_kZEbiogOIFf5skhFuKlouVr1yaOA8cQHMMsx6XPcX7bneFMuTKGXNWB.UyY9QYJriSK.MhORSMR6',
            opportunityId: '006MOCK_OPP_ID',
            accountId: '001MOCK_ACC_ID',
            accountName: 'Cymbal (Mock Content)',
            opportunityName: 'Mock Opportunity',
            isGCPFamily: true,
            salesChannel: 'Partner',
            primaryContactName: 'Sarah Connor',
            apiBaseUrl: 'https://vector--rcaagivant.sandbox.my.salesforce.com' // Default for local dev
        };
    }

    get currentContext() {
        return this.contextSubject.value;
    }

    get accountName(): string {
        return this.currentContext.accountName;
    }

    get opportunityName(): string {
        return this.currentContext.opportunityName;
    }

    get isGCP(): boolean {
        return !!this.currentContext.isGCPFamily;
    }

    get salesChannel(): string {
        return this.currentContext.salesChannel;
    }

    get website(): string {
        return this.currentContext.website || 'salesforce.com';
    }

    get primaryContactName(): string {
        return this.currentContext.primaryContactName;
    }

    get uniqueQuoteId(): string {
        return this.currentContext.quoteId || 'Q-1234';
    }

    get accessToken(): string {
        return this.currentContext.accessToken || '';
    }

    get apiBaseUrl(): string {
        return this.currentContext.apiBaseUrl || '';
    }

    updateContext(newContext: any) {
        const updated = { ...this.currentContext, ...newContext };
        this.contextSubject.next(updated);
    }

    /**
     * Fetches a fresh session token from the external auth API
     */
    fetchSessionToken(): Observable<string> {
        const authUrl = 'https://dealmanagementbackend-production-49da.up.railway.app/auth/session';
        console.log('[ContextService] Fetching new session token from:', authUrl);

        const startTime = new Date();
        const start = performance.now();
        // Manually log this since we bypass interceptors
        // We need to inject LoggingService first. 
        // Since we can't easily inject it in the middle of a replaced block without constructor changes if not already there...
        // Wait, I need to check if LoggingService is injected. It's not.
        // using runInInjectionContext or just simple console.log for now? 
        // Better to add LoggingService to injections.

        return this.http.get<any>(authUrl).pipe(
            map(response => response.access_token),
            tap({
                next: (token) => {
                    if (token) {
                        console.log('[ContextService] New session token received.');
                        sessionStorage.setItem('access_token', token);
                        this.updateContext({ accessToken: token });
                    }
                    this.logRefreshCall(authUrl, 'GET', 200, startTime, start);
                },
                error: (err) => {
                    this.logRefreshCall(authUrl, 'GET', err.status || 0, startTime, start, err.message);
                }
            }),
            catchError(err => {
                console.error('[ContextService] Failed to fetch session token', err);
                return of('');
            })
        );
    }

    // Helper to log manual API calls (since they bypass interceptors)

    private logRefreshCall(url: string, method: string, status: number, startTime: Date, start: number, error?: string) {
        const duration = performance.now() - start;
        this.loggingService.logMetric({
            url,
            method,
            status,
            startTime: startTime.toISOString(),
            durationMs: Math.round(duration),
            user: 'system',
            error
        });
    }

}
