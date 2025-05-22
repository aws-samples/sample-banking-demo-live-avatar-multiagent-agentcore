import anime from "animejs";

interface ScrollOptions {
    container?: HTMLElement | Window | null;
    target?: HTMLElement | null;
    debug?: boolean;
}

interface AnimationInstance {
    animatables: Array<{ target: HTMLElement }>;
    duration: number;
    seek: (time: number) => void;
    [key: string]: unknown;
}

/**
 * Creates a scroll-based animation controller
 * @param options Scroll options
 * @returns A function that controls animation playback based on scroll position
 */
export const onScroll = (options: ScrollOptions = {}) => {
    const { container = window, target = null, debug = false } = options;

    // Return a function that controls animation playback
    return (animation: AnimationInstance) => {
        // Store animation instance
        let anim = animation;

        // Calculate element position and dimensions
        const getElementInfo = () => {
            const targetEl = target || anim.animatables[0].target;
            const rect = targetEl.getBoundingClientRect();
            const scrollTop =
                container === window ? window.scrollY : (container as HTMLElement).scrollTop;
            const scrollHeight =
                container === window
                    ? document.documentElement.scrollHeight - window.innerHeight
                    : (container as HTMLElement).scrollHeight -
                      (container as HTMLElement).clientHeight;

            return { rect, scrollTop, scrollHeight };
        };

        // Calculate animation progress based on scroll position
        const updateAnimation = () => {
            const { rect } = getElementInfo();
            const windowHeight =
                container === window ? window.innerHeight : (container as HTMLElement).clientHeight;

            // Calculate how far the element is through the viewport
            const elementProgress = 1 - rect.bottom / windowHeight;

            // Clamp progress between 0 and 1
            const progress = Math.max(0, Math.min(1, elementProgress));

            // Update animation progress
            if (anim && anim.duration) {
                anim.seek(anim.duration * progress);
            }

            // Show debug info if enabled
            if (debug) {
                console.log(
                    `Element progress: ${elementProgress.toFixed(2)}, Animation progress: ${progress.toFixed(2)}`
                );
            }
        };

        // Add scroll event listener
        const handleScroll = () => {
            requestAnimationFrame(updateAnimation);
        };

        // Attach scroll listener
        if (container === window) {
            window.addEventListener("scroll", handleScroll);
        } else if (container) {
            container.addEventListener("scroll", handleScroll);
        }

        // Initial update
        updateAnimation();

        // Return animation controller
        return {
            play: () => {},
            pause: () => {},
            restart: () => {
                updateAnimation();
            },
            seek: (time: number) => {
                if (anim) anim.seek(time);
            },
        };
    };
};

// Type declaration for anime.timeline
export interface AnimeTimelineInstance {
    add: (
        params: Record<string, unknown>,
        timelineOffset?: string | number
    ) => AnimeTimelineInstance;
    duration: number;
    seek: (time: number) => void;
    [key: string]: unknown;
}

interface TimelineParams {
    autoplay?: boolean;
    easing?: string;
    [key: string]: unknown;
}

/**
 * Creates a timeline animation
 * @param params Animation parameters
 * @returns Timeline instance
 */
export const createTimeline = (params: TimelineParams = {}): AnimeTimelineInstance => {
    // Use type assertion to handle the unknown type
    const timeline = (
        anime as unknown as { timeline: (params: TimelineParams) => AnimeTimelineInstance }
    ).timeline(params);
    return timeline;
};

interface TimerParams {
    duration?: number;
    autoplay?: boolean;
    loop?: boolean;
    onUpdate?: (anim: AnimationInstance) => void;
    onComplete?: () => void;
    easing?: string;
}

/**
 * Creates a timer animation
 * @param params Animation parameters
 * @returns Timer instance
 */
export const createTimer = (params: TimerParams = {}) => {
    return anime({
        targets: document.createElement("div"), // Create a dummy target
        duration: params.duration || 1000,
        autoplay: params.autoplay || false,
        loop: params.loop || false,
        update: params.onUpdate || null,
        complete: params.onComplete || null,
        easing: params.easing || "linear",
    });
};

/**
 * Utility functions
 */
export const utils = {
    // Query selector helper
    $: (selector: string) => {
        return Array.from(document.querySelectorAll(selector));
    },

    // Get element dimensions
    getDimensions: (element: HTMLElement) => {
        return element.getBoundingClientRect();
    },

    // Check if element is in viewport
    isInViewport: (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    },
};

// Export anime as default for convenience
export const animate = anime;
export default anime;
