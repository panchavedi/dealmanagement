export interface ApiDetails {
    name: string;
    description: string;
}

export function getApiDetails(url: string, method: string, body?: any): ApiDetails {
    // Default fallback
    let name = 'General API Call';
    let description = 'Unknown API operation';

    // Helper to check query params
    const getQueryParam = (urlStr: string, param: string): string | null => {
        try {
            const urlObj = new URL(urlStr, 'http://localhost'); // Base URL needed for relative paths
            return urlObj.searchParams.get(param);
        } catch (e) {
            return null;
        }
    };

    const isQuery = url.includes('/query') || url.includes('/query/');
    const isGraphApi = url.includes('/sales-transaction/actions/place');
    const isCompositeTree = url.includes('/composite/tree/');
    const isUiApi = url.includes('/ui-api/');
    const isProductsApi = url.includes('/connect/pcm/products') || url.includes('/connect/cpq/products');
    const isSObject = url.includes('/sobjects/');

    // --- 1. SOQL Queries ---
    if (isQuery) {
        const query = getQueryParam(url, 'q');
        if (query) {
            const qUpper = query.toUpperCase();
            name = 'SOQL Query';
            description = 'Executes a SOQL query';

            if (qUpper.includes('FROM OPPORTUNITY')) {
                name = 'Get Opportunity Details';
                description = 'Fetches details for an Opportunity';
                if (qUpper.includes('LIMIT 5')) {
                    name = 'Get Recent Opportunities';
                    description = 'Fetches list of recently created opportunities';
                }
            } else if (qUpper.includes('FROM ACCOUNT')) { // Usually joined with Opportunity, but if standalone
                name = 'Get Account Details';
                description = 'Fetches details for an Account';
            } else if (qUpper.includes('FROM QUOTE')) {
                name = 'Get Quote Details';
                description = 'Fetches details for a specific Quote';
                if (qUpper.includes('QUOTELINEITEMS')) {
                    name = 'Get Quote Preview';
                    description = 'Fetches Quote details including line items';
                }
            } else if (qUpper.includes('FROM QUOTELINEITEM')) {
                name = 'Get Quote Lines';
                description = 'Fetches line items for a Quote';
            } else if (qUpper.includes('FROM PRICEBOOKENTRY')) {
                name = 'Get Pricebook Entries';
                description = 'Fetches pricing information for products';
            } else if (qUpper.includes('FROM PRODUCT2')) {
                name = 'Get Recent Products';
                description = 'Fetches recently modified products';
            } else if (qUpper.includes('FROM PRODUCTCLASSIFICATION')) {
                name = 'Get Product Classifications';
                description = 'Fetches product classification/catalog structure';
            }
        }
    }

    // --- 2. Sales Transaction API (Graph API) ---
    else if (isGraphApi && method === 'POST') {
        name = 'Sales Transaction API';
        description = 'Executes a composite graph request';

        // Check body for graphId if available
        if (body && body.graph && body.graph.graphId) {
            const graphId = body.graph.graphId;
            if (graphId === 'createQuote') {
                name = 'Create Quote';
                description = 'Creates a new Quote with initial line items';
            } else if (graphId === 'updateQuoteWithFields') {
                name = 'Update Quote';
                description = 'Updates Quote fields and commitment values';
            } else {
                name = `Graph API: ${graphId}`;
                description = `Executes graph request: ${graphId}`;
            }
        } else {
            // Fallback if no graphId (e.g. placeSalesTransaction generic)
            name = 'Place Sales Transaction';
            description = 'Generic sales transaction request';
        }
    }

    // --- 3. Composite Tree API ---
    else if (isCompositeTree && method === 'POST') {
        if (url.includes('Commitment_Details__c')) {
            name = 'Create Commitments';
            description = 'Creates Commitment Detail records';
        }
    }

    // --- 4. UI API (Picklist Values) ---
    else if (isUiApi) {
        if (url.includes('/picklist-values/')) {
            name = 'Get Picklist Values';
            // Extract object name if possible: .../object-info/QuoteLineItem/picklist-values/...
            const match = url.match(/object-info\/([^\/]+)\/picklist-values/);
            const objectName = match ? match[1] : 'Object';
            description = `Fetches picklist values for ${objectName}`;
        }
    }

    // --- 5. Products API ---
    else if (isProductsApi) {
        if (method === 'GET') {
            if (url.includes('productClassificationId=')) {
                name = 'Get Products by Category';
                description = 'Fetches products for a specific classification';
            } else {
                // Check if it's a specific product ID
                const isPcm = url.includes('/connect/pcm/products/');
                const isCpq = url.includes('/connect/cpq/products/');
                const parts = url.split(isPcm ? '/connect/pcm/products/' : '/connect/cpq/products/');

                if (parts.length > 1 && parts[1].length > 5) {
                    name = 'Get Product Details';
                    description = 'Fetches details for a specific product';
                } else {
                    name = 'List Products';
                    description = 'Fetches a list of products';
                }
            }
        } else if (method === 'POST') {
            name = 'Filter/List Products';
            description = 'Fetches products based on criteria/classification';
        }
    }

    // --- 6. SObjects (Standard REST) ---
    else if (isSObject) {
        if (url.includes('/sobjects/Account/')) {
            name = 'Get Account Details';
            description = 'Fetches standard Account fields';
        } else if (url.includes('/sobjects/Contact/')) {
            name = 'Get Contact Details';
            description = 'Fetches standard Contact fields';
        } else if (url.includes('/sobjects/Quote/')) {
            if (method === 'GET') {
                name = 'Get Quote';
                description = 'Fetches standard Quote fields';
            } else if (method === 'PATCH') {
                name = 'Update Quote Dates';
                description = 'Updates Quote Start/End dates';
            }
        } else if (url.includes('/sobjects/ProductRelationshipType')) {
            name = 'Get Relationship Types';
            description = 'Fetches product relationship type metadata';
        }
    }

    return { name, description };
}
