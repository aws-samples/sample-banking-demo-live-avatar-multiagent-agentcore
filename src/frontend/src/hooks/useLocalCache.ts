import { useQuery } from "@tanstack/react-query";

interface CacheConfig {
    enabled: boolean;
    maxAge: number; // in milliseconds
    maxSize: number; // max items in cache
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
    enabled: true,
    maxAge: 60 * 60 * 1000, // 1 hour to match the s3 url expiration
    maxSize: 400
};

class LocalAssetCache {
    private config: CacheConfig;
    private cache: Map<string, { data: any; timestamp: number; size: number }>;

    constructor(config: CacheConfig = DEFAULT_CACHE_CONFIG) {
        this.config = config;
        this.cache = new Map();
        this.loadFromStorage();
    }

    private getStorageKey() {
        return 'workflow-asset-cache';
    }

    private loadFromStorage() {
        console.debug('load from storage')
        if (!this.config.enabled) return;
        
        try {
            const stored = localStorage.getItem(this.getStorageKey());
            console.debug('load from storage', this.getStorageKey())

            if (stored) {
                const parsed = JSON.parse(stored);
                this.cache = new Map(parsed);
            }
        } catch (e) {
            console.warn('Failed to load cache from localStorage:', e);
        }
    }

    private saveToStorage() {
        console.log('save to storage')
        if (!this.config.enabled) return;
        
        try {
            const serialized = JSON.stringify(Array.from(this.cache.entries()));
            localStorage.setItem(this.getStorageKey(), serialized);
            console.log('saved to storage', this.getStorageKey())

        } catch (e) {
            console.warn('Failed to save cache to localStorage:', e);
        }
    }

    private isExpired(timestamp: number): boolean {
        return Date.now() - timestamp > this.config.maxAge;
    }

    private evictOldest() {
        if (this.cache.size <= this.config.maxSize) return;
        
        const entries = Array.from(this.cache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        const toRemove = entries.slice(0, entries.length - this.config.maxSize);
        toRemove.forEach(([key]) => this.cache.delete(key));
    }

    get(key: string): any | null {
        if (!this.config.enabled) return null;
        
        const item = this.cache.get(key);
        if (!item || this.isExpired(item.timestamp)) {
            this.cache.delete(key);
            return null;
        }
        return item.data;
    }

    set(key: string, data: any): void {
        if (!this.config.enabled) return;
        
        const size = JSON.stringify(data).length;
        this.cache.set(key, { data, timestamp: Date.now(), size });
        this.evictOldest();
        this.saveToStorage();
    }

    clear(): void {
        this.cache.clear();
        localStorage.removeItem(this.getStorageKey());
    }

    getStats() {
        const totalSize = Array.from(this.cache.values()).reduce((sum, item) => sum + item.size, 0);
        return {
            itemCount: this.cache.size,
            totalSize,
            enabled: this.config.enabled
        };
    }
}

// Global cache instance
const assetCache = new LocalAssetCache();

export const useLocalCache = () => {
    return {
        get: (key: string) => assetCache.get(key),
        set: (key: string, data: any) => assetCache.set(key, data),
        clear: () => assetCache.clear(),
        getStats: () => assetCache.getStats(),
        configure: (config: Partial<CacheConfig>) => {
            Object.assign(assetCache['config'], config);
        }
    };
};

export const useCachedQuery = <T>(
    queryKey: string[],
    queryFn: () => Promise<T>,
    options: { enabled?: boolean; staleTime?: number } = {}
) => {
    const cache = useLocalCache();
    const cacheKey = queryKey.join(':');

    return useQuery({
        queryKey,
        queryFn: async () => {
            // Try cache first
            const cached = cache.get(cacheKey);
            console.debug('isCached?', cached, cacheKey)
            if (cached) {
                return cached;
            }

            // Fetch from S3 and cache
            const data = await queryFn();
            cache.set(cacheKey, data);
            return data;
        },
        ...options
    });
};