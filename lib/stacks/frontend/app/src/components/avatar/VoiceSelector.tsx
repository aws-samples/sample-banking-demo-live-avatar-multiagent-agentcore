import Select, { SelectProps } from "@cloudscape-design/components/select";
import FormField from "@cloudscape-design/components/form-field";
import { type LanguageCode, getVoicesForLanguage } from "@/lib/websocket-client/voice-config";

interface VoiceSelectorProps {
    language: LanguageCode;
    value: string;
    onChange: (voiceId: string) => void;
    disabled?: boolean;
}

export function VoiceSelector({ language, value, onChange, disabled = false }: VoiceSelectorProps) {
    const voices = getVoicesForLanguage(language);

    const options: SelectProps.Option[] = voices.map((voice) => ({
        value: voice.id,
        label: `${voice.name} (${voice.gender})`,
    }));

    const selectedOption = options.find((opt) => opt.value === value) ?? null;

    return (
        <FormField label="Voice">
            <Select
                selectedOption={selectedOption}
                onChange={({ detail }) => {
                    if (detail.selectedOption.value) {
                        onChange(detail.selectedOption.value);
                    }
                }}
                options={options}
                disabled={disabled}
                placeholder="Select a voice"
            />
        </FormField>
    );
}

export default VoiceSelector;
