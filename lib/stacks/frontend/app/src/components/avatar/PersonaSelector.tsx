import type { PersonaId } from "@/lib/websocket-client/client";
import Select from "@cloudscape-design/components/select";
import FormField from "@cloudscape-design/components/form-field";

interface PersonaDef {
    id: PersonaId;
    label: string;
    description: string;
}

const PERSONAS: PersonaDef[] = [
    { id: "friendly", label: "Balanced", description: "Warm, conversational, natural" },
    { id: "professional", label: "Professional", description: "Precise, clear, direct" },
    { id: "educational", label: "Educator", description: "Patient, step-by-step" },
    { id: "creative", label: "Creative", description: "Vivid, inventive, grounded" },
    { id: "technical", label: "Technical", description: "Concise, analytical" },
];

const OPTIONS = PERSONAS.map((p) => ({
    value: p.id,
    label: p.label,
    description: p.description,
}));

interface PersonaSelectorProps {
    value: PersonaId;
    onChange: (persona: PersonaId) => void;
    disabled?: boolean;
}

export function PersonaSelector({ value, onChange, disabled }: PersonaSelectorProps): JSX.Element {
    const selectedOption = OPTIONS.find((o) => o.value === value) || OPTIONS[0];

    return (
        <FormField label="Persona">
            <Select
                selectedOption={selectedOption}
                onChange={({ detail }) => onChange(detail.selectedOption.value as PersonaId)}
                options={OPTIONS}
                disabled={disabled}
            />
        </FormField>
    );
}
