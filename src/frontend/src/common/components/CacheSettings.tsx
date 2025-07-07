import { useState } from 'react';
import { Button, Modal, Header, SpaceBetween, Toggle, FormField, Box } from '@cloudscape-design/components';
import { useLocalCache } from '../../hooks/useLocalCache';

interface CacheSettingsProps {
    visible: boolean;
    onDismiss?: () => void;
}

export const CacheSettings = ({ visible, onDismiss }: CacheSettingsProps) => {
    const cache = useLocalCache();
    const [cacheEnabled, setCacheEnabled] = useState(true);
    const [maxAge, setMaxAge] = useState('24');
    const [refreshKey, setRefreshKey] = useState(0);
    const stats = cache.getStats();

    const handleToggleCache = (enabled: boolean) => {
        setCacheEnabled(enabled);
        cache.configure({ enabled });
    };

    const handleMaxAgeChange = (hours: string) => {
        setMaxAge(hours);
        const maxAgeMs = parseInt(hours) * 60 * 60 * 1000;
        cache.configure({ maxAge: maxAgeMs });
    };

    const handleClearCache = () => {
        cache.clear();
        setRefreshKey(prev => prev + 1);
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <Modal
            visible={visible}
            onDismiss={onDismiss}
            header="Cache Settings"
            closeAriaLabel="Close modal"
        >
            <SpaceBetween size="m">
                <FormField label="Enable Local Caching">
                    <Toggle
                        checked={cacheEnabled}
                        onChange={({ detail }) => handleToggleCache(detail.checked)}
                    >
                        Cache workflow assets locally
                    </Toggle>
                </FormField>

                <FormField label="Cache Statistics">
                    <Box>
                        <p>Items cached: {stats.itemCount}</p>
                        <p>Total size: {formatBytes(stats.totalSize)}</p>
                        <p>Status: {stats.enabled ? 'Enabled' : 'Disabled'}</p>
                    </Box>
                </FormField>

                <Button onClick={handleClearCache} disabled={!cacheEnabled}>
                    Clear Cache
                </Button>
            </SpaceBetween>
        </Modal>
    );
};

export const useCacheSettingsModal = () => {
    const [visible, setVisible] = useState(false);
    return {
        visible,
        open: () => setVisible(true),
        close: () => setVisible(false)
    };
};