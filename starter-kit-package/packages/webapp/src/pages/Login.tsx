import { Box, Button, SpaceBetween, TextContent } from "@cloudscape-design/components"
import { signInWithRedirect } from '@aws-amplify/auth'
import BotLogo from "../assets/bot_logo.png"
import { Authenticator, components, useTheme, View, Text, Heading, useAuthenticator, Button as AmplifyButton } from "@aws-amplify/ui-react"
import { motion } from "motion/react"

export const Login = () => {

    const components = {
        SignIn: {
            Header() {
                const { tokens } = useTheme();
                return (
                    <Heading
                        padding={`${tokens.space.small} 0 0 ${tokens.space.small}`}
                        level={6}
                        style={{ textAlign: 'center' }}
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
                            fontWeight="normal"
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
                    <Text color={tokens.colors.black}>
                        &copy; All Rights Reserved
                    </Text>
                </View>
            );
        },
    }

    const formFields = {
        signIn: {
            username: {
                isRequired: true,
                label: 'Email:',
                placeholder: 'Enter your email',
            },
        },
        resetPassword: {
            username: {
                type: "email",
                isRequired: true,
                label: 'Email:',
                placeholder: 'Enter your email',
            },
        },

    }

    return (
        <motion.div
            initial={{
                opacity: 0
            }
            }
            animate={{
                x: 0,
                opacity: 1
            }}
            transition={{
                duration: 1,
                delay: 0.25,
                ease: "circInOut"
            }}>
            <div style={{
                width: "100%",
                height: "100vh",
                background: "linear-gradient(150deg, rgba(255,255,255,1) 51%, rgba(84,36,124,1) 51%, rgba(17,90,179,1) 88%)",
                overflow: 'hidden',
                scrollbarWidth: 'none',
                justifyContent: 'center'
            }}>
                <motion.div
                    initial={{
                        // x: 300,
                        y: 500,
                        opacity: 0
                    }}
                    animate={{
                        x: 0,
                        y: 0,
                        opacity: 1
                    }}
                    transition={{
                        duration: 0.5,
                        delay: 0.5,
                        ease: "easeInOut"
                    }}>
                    <div style={{
                        display: "flex",
                        justifyContent: "center",
                        alignContent: 'center',
                        justifySelf: "center",
                        width: "50vw",
                        height: "90vh",
                        boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.75)",
                        borderRadius: "1vw",
                        background: "linear-gradient(191deg, rgba(238,174,202,1) 0%, rgba(148,187,233,1) 100%)",
                        position: "relative",
                        top: "50vh",
                        transform: "translateY(-50%)",
                        overflow: 'hidden',
                        scrollbarWidth: 'none'
                    }}>

                        <SpaceBetween direction="vertical" size="m">
                            <Box padding={{ top: "m" }} variant="h1" textAlign="center">
                                <TextContent>
                                    <center>
                                        <h2 style={{ color: "black" }}>App Name</h2>
                                    </center>
                                </TextContent>

                            </Box>
                            <Box
                                color="text-body-secondary"
                                textAlign="center"
                                fontWeight="bold"
                                fontSize="heading-m"
                                padding={{ bottom: "xs", top: "xs" }}
                            >
                                <img src={BotLogo} alt="Logo" height={200} width={150} style={{
                                    borderRadius: "1vw",
                                    boxShadow: "0px 0px 10px 0px rgba(0,0,0,0.75)"
                                }} />
                            </Box>
                            {import.meta.env.VITE_MIDWAY === "true" &&
                                <Box padding={{ bottom: "s" }} variant="h1" textAlign="center">
                                    <Button onClick={() => signInWithRedirect()} variant="primary">Login with Midway</Button>
                                </Box>}
                            {import.meta.env.VITE_MIDWAY === "true" &&
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    width: '100%',

                                }}>
                                    <div style={{
                                        flexGrow: 1,
                                        height: '2px',
                                        backgroundColor: "black"
                                    }} />
                                    <span style={{
                                        padding: `0 2vh`,
                                        color: "#333333",
                                        fontSize: '14px'
                                    }}>
                                        <div>OR</div>
                                    </span>
                                    <div style={{
                                        flexGrow: 1,
                                        height: "2px",
                                        backgroundColor: "black"
                                    }} />
                                </div>}

                            <Authenticator hideSignUp={true} components={components} formFields={formFields} />
                        </SpaceBetween>
                    </div>
                </motion.div>
            </div>
        </motion.div >

    )
}