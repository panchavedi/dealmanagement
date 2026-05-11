import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { LoaderComponent } from './components/loader/loader.component';
import { ToastComponent } from './components/toast/toast.component';
import { TwAuthService } from './services/tw-auth.service';
import { CartService } from './services/cart.service';
import { QuoteDataService } from './services/quote-data.service';
import { DiscountIncentiveStateService } from './services/discount-incentive-state.service';
import { filter } from 'rxjs/operators';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [RouterOutlet, LoaderComponent, ToastComponent],
    template: `
        <app-loader></app-loader>
        <app-toast></app-toast>
        <router-outlet></router-outlet>
    `,
})
export class AppComponent implements OnInit {
    title = 'google-quote-creation';

    private authService = inject(TwAuthService);
    private router = inject(Router);
    private cartService = inject(CartService);
    private quoteService = inject(QuoteDataService);
    private discountStateService = inject(DiscountIncentiveStateService);

    ngOnInit() {
        console.log('🚀 AppComponent.ngOnInit() called');
        this.setupStateClearingListener();

        // Auto-login logic: Check if we're on the callback route
        const currentPath = window.location.pathname;
        console.log('📍 Current path:', currentPath);

        // Skip auto-login if we're handling the callback
        if (currentPath === '/callback') {
            console.log('⏭️ Skipping auto-login (on callback route)');
            return;
        }

        // TEMPORARILY DISABLED AUTO-LOGIN FOR DEBUGGING
        // Use the debug page at /#/debug to manually trigger login
        console.log('⚠️ Auto-login is DISABLED. Use /#/debug to manually test.');

        /*
        // If no token exists, trigger PKCE login automatically
        const isAuth = this.authService.isAuthenticated();
        console.log('🔐 isAuthenticated():', isAuth);
        
        if (!isAuth) {
            console.log('❌ No access token found. Initiating PKCE authentication...');
            this.authService.login();
        } else {
            console.log('✅ Access token found. User is authenticated.');
        }
        */
    }

    private setupStateClearingListener(): void {
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe((event: any) => {
            const url = event.urlAfterRedirects || event.url;
            // Clear state if we land on the opportunities list (root or /opportunities)
            if (url === '/' || url === '' || url.startsWith('/?')) {
                console.log('🧹 [Global Clear] Navigated to Opportunities list. Clearing stale state...');
                this.clearAllServiceStates();
                this.clearSessionData();
            }
        });
    }

    private clearAllServiceStates(): void {
        this.cartService.clearCart();
        this.quoteService.clearQuoteData();
        this.discountStateService.clearState();
    }

    private clearSessionData(): void {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key) {
                const kLower = key.toLowerCase();
                if (kLower.includes('token') || kLower.includes('auth') || kLower.includes('expire')) {
                    continue;
                }
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => sessionStorage.removeItem(key));
    }
}
