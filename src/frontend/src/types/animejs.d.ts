declare module "animejs" {
    export interface AnimeInstance {
        progress: number;
        [key: string]: unknown;
    }

    export interface AnimeParams {
        targets: string | Element | Element[] | NodeList;
        [key: string]: unknown;
    }

    export interface AnimeStatic {
        (params: AnimeParams): AnimeInstance;
        stagger: (value: number, options?: Record<string, unknown>) => unknown;
        [key: string]: unknown;
    }

    const anime: AnimeStatic;
    export default anime;
}
