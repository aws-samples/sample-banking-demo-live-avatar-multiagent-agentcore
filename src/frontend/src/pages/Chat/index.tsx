import {
    Button,
    ContentLayout,
    Form,
    FormField,
    Header,
    Input,
    SpaceBetween,
} from "@cloudscape-design/components";
import { useContext, useState } from "react";
import Layout from "../../common/components/Layout";
import { FlashbarContext, FlashbarItem } from "../../common/contexts/Flashbar";
import { postRestTestMessage } from "./api";

const Chat = () => {
    const { addFlashbarItem } = useContext(FlashbarContext);
    const [message, setMessage] = useState("");

    const submitMessageForm = async () => {
        const response = (await postRestTestMessage(message)) as unknown as FlashbarItem;
        addFlashbarItem(response.type, response.content);
    };

    return (
        <Layout
            content={
                <ContentLayout header={<Header variant="h2">Chat</Header>}>
                    <form
                        id="messageForm"
                        onSubmit={(e) => {
                            e.preventDefault();
                            submitMessageForm();
                        }}
                    >
                        <Form>
                            <SpaceBetween direction="vertical" size="l">
                                <FormField label="Message">
                                    <Input
                                        onChange={({ detail }) => setMessage(detail.value)}
                                        value={message}
                                    />
                                </FormField>
                                <FormField>
                                    <Button variant="normal" form="messageForm" disabled={!message}>
                                        Send Message
                                    </Button>
                                </FormField>
                            </SpaceBetween>
                        </Form>
                    </form>
                </ContentLayout>
            }
        />
    );
};

export default Chat;
