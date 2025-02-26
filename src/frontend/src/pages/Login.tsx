import { signInWithRedirect } from "@aws-amplify/auth";
import {
    Button as AmplifyButton,
    Authenticator,
    Heading,
    Text,
    useAuthenticator,
    useTheme,
    View,
} from "@aws-amplify/ui-react";
import { Box, Button, SpaceBetween } from "@cloudscape-design/components";
import { motion } from "motion/react";

const Login = () => {
    const components = {
        SignIn: {
            Header() {
                const { tokens } = useTheme();
                return (
                    <Heading
                        padding={`${tokens.space.medium} 0 0`}
                        level={6}
                        style={{ textAlign: "center" }}
                    >
                        Login with Amazon Cognito
                    </Heading>
                );
            },
            Footer() {
                const { toForgotPassword } = useAuthenticator();
                return (
                    <View textAlign="center">
                        <AmplifyButton
                            fontWeight="bold"
                            onClick={toForgotPassword}
                            size="small"
                            variation="link"
                        >
                            Reset Password
                        </AmplifyButton>
                    </View>
                );
            },
        },
        Footer() {
            const { tokens } = useTheme();
            return (
                <View textAlign="center" padding={tokens.space.large}>
                    <Text color={tokens.colors.black}>&copy; All Rights Reserved</Text>
                </View>
            );
        },
    };

    const formFields = {
        signIn: {
            username: {
                isRequired: true,
                label: "Email:",
                placeholder: "Enter your email",
            },
        },
        resetPassword: {
            username: {
                type: "email",
                isRequired: true,
                label: "Email:",
                placeholder: "Enter your email",
            },
        },
    };

    return (
        <motion.div
            initial={{
                opacity: 0,
            }}
            animate={{
                opacity: 1,
            }}
            transition={{
                duration: 0.5,
                delay: 0.5,
                ease: "easeInOut",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    justifySelf: "center",
                    boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.75)",
                    background:
                        "linear-gradient(191deg, rgba(238,174,202,1) 0%, rgba(148,187,233,1) 100%)",
                    width: "min(600px, 80vw)",
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                }}
            >
                <SpaceBetween direction="vertical" size="xl">
                    <Box padding={{ top: "xxl" }} variant="h1" textAlign="center">
                        <Button onClick={() => signInWithRedirect()} variant="normal">
                            Login with Midway
                        </Button>
                    </Box>
                    <Authenticator
                        hideSignUp={true}
                        components={components}
                        formFields={formFields}
                    />
                </SpaceBetween>
            </div>
        </motion.div>
    );
};

export default Login;
