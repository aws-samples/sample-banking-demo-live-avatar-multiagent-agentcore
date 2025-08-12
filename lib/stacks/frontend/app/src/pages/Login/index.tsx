// @export {"replace": ", Button, Divider, Flex ", "with": ""}
import { Authenticator, Button, Divider, Flex } from "@aws-amplify/ui-react";
// @export {"deleteLines": 2}
import { signInWithRedirect } from "aws-amplify/auth";
import Amazicon from "./amazicon.svg";

const Login = () => {
    return (
        <Authenticator
            hideSignUp={true}
            variation="modal"
            // socialProviders={["amazon"]}
            // @export {"deleteLines": 19}
            components={{
                SignIn: {
                    Header: () => {
                        return (
                            <Flex direction="column" padding="2rem 2rem 0">
                                <Button onClick={() => signInWithRedirect()} gap="1rem" isFullWidth>
                                    <img
                                        src={Amazicon}
                                        alt="Amazon icon"
                                        style={{ width: "15px" }}
                                    />
                                    Sign in with Midway
                                </Button>
                                <Divider label="or" size="small" />
                            </Flex>
                        );
                    },
                },
            }}
        />
    );
};

export default Login;
