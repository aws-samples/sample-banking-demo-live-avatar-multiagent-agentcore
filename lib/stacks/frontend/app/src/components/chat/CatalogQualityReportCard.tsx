import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck } from "lucide-react";

/**
 * Automatic quality-control report for the Services Catalog (AI Assistant).
 *
 * Rendered from the backend `CatalogQualityReport` generative-UI event, which
 * carries the result of the deterministic `_qc_validate_catalog` pass. It shows
 * how the assistant verifies FORMAT, LENGTH, and FILTERS irrelevant/placeholder
 * content before the catalog is exported — the "automatic quality control" the
 * demo is required to demonstrate.
 */

type Status = "pass" | "warn" | "fail";

interface QcCheck {
    item: string;
    rule: string;
    status: Status;
    detail: string;
}

interface QcSummary {
    sections: number;
    items: number;
    images: number;
    passed: number;
    warnings: number;
    errors: number;
}

interface CatalogQualityReportProps {
    overall?: Status;
    summary?: QcSummary;
    checks?: QcCheck[];
}

const OVERALL_META: Record<Status, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
    pass: { label: "Passed", className: "text-emerald-400", Icon: CheckCircle2 },
    warn: { label: "Passed with warnings", className: "text-amber-400", Icon: AlertTriangle },
    fail: { label: "Issues found", className: "text-red-400", Icon: XCircle },
};

const STATUS_ICON: Record<Status, { Icon: typeof CheckCircle2; className: string }> = {
    pass: { Icon: CheckCircle2, className: "text-emerald-400" },
    warn: { Icon: AlertTriangle, className: "text-amber-400" },
    fail: { Icon: XCircle, className: "text-red-400" },
};

const RULE_LABEL: Record<string, string> = {
    format: "Format",
    length: "Length",
    filter: "Filter",
};

export function CatalogQualityReportCard({
    overall = "pass",
    summary,
    checks = [],
}: CatalogQualityReportProps): JSX.Element {
    const meta = OVERALL_META[overall];
    const { Icon } = meta;
    // Surface issues first; a clean run shows the reassuring summary only.
    const issues = checks.filter((c) => c.status !== "pass");

    return (
        <div className="my-2 rounded-lg border border-slate-700 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />
                <h3 className="text-sm font-semibold text-slate-100">Automatic Quality Control</h3>
                <span className={`ml-auto inline-flex items-center gap-1 text-xs font-medium ${meta.className}`}>
                    <Icon className="h-4 w-4" aria-hidden />
                    {meta.label}
                </span>
            </div>

            {summary && (
                <dl className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {[
                        { label: "Sections", value: summary.sections },
                        { label: "Items", value: summary.items },
                        { label: "Images", value: summary.images },
                        { label: "Checks OK", value: summary.passed },
                        { label: "Warnings", value: summary.warnings },
                        { label: "Errors", value: summary.errors },
                    ].map((s) => (
                        <div
                            key={s.label}
                            className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1.5 text-center"
                        >
                            <dt className="text-[10px] uppercase tracking-wide text-slate-500">{s.label}</dt>
                            <dd className="text-sm font-semibold text-slate-100">{s.value}</dd>
                        </div>
                    ))}
                </dl>
            )}

            <p className="mb-2 text-[11px] text-slate-400">
                Verified format (required fields), length (description bounds), and filtered
                irrelevant or placeholder content.
            </p>

            {issues.length === 0 ? (
                <p className="text-xs text-emerald-400">
                    All checks passed — catalog is ready to export.
                </p>
            ) : (
                <ul className="space-y-1.5">
                    {issues.map((c, i) => {
                        const { Icon: RowIcon, className } = STATUS_ICON[c.status];
                        return (
                            <li key={`${c.item}-${c.rule}-${i}`} className="flex items-start gap-2 text-xs">
                                <RowIcon className={`mt-0.5 h-3.5 w-3.5 flex-none ${className}`} aria-hidden />
                                <span className="text-slate-300">
                                    <span className="font-medium text-slate-100">{c.item}</span>
                                    <span className="mx-1 rounded bg-slate-800 px-1 text-[10px] uppercase text-slate-400">
                                        {RULE_LABEL[c.rule] ?? c.rule}
                                    </span>
                                    {c.detail}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
