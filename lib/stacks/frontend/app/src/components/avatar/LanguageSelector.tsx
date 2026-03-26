import Select, { SelectProps } from "@cloudscape-design/components/select";
import FormField from "@cloudscape-design/components/form-field";
import { type LanguageCode, LANGUAGES } from "@/lib/websocket-client/voice-config";

interface LanguageSelectorProps {
    value: LanguageCode;
    onChange: (lang: LanguageCode) => void;
    disabled?: boolean;
}

const LANGUAGE_OPTIONS: SelectProps.Option[] = LANGUAGES.map((lang) => ({
    value: lang.code,
    label: `${lang.flag} ${lang.label}`,
}));

export function LanguageSelector({ value, onChange, disabled = false }: LanguageSelectorProps) {
    const selectedOption = LANGUAGE_OPTIONS.find((opt) => opt.value === value) ?? null;

    return (
        <FormField label="Language">
            <Select
                selectedOption={selectedOption}
                onChange={({ detail }) => {
                    if (detail.selectedOption.value) {
                        onChange(detail.selectedOption.value as LanguageCode);
                    }
                }}
                options={LANGUAGE_OPTIONS}
                disabled={disabled}
                placeholder="Select a language"
            />
        </FormField>
    );
}

export default LanguageSelector;
