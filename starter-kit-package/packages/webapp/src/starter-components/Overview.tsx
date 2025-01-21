import { ColumnLayout, Container, Header, Link, SpaceBetween, TextContent } from "@cloudscape-design/components"
import { useSetAtom } from "jotai";
import { CiDatabase } from "react-icons/ci";
import { PiMagicWandDuotone, PiSneakerMove } from "react-icons/pi";

import { FaAws } from "react-icons/fa";
import { animate, motion, Variants } from "motion/react"
import { toggleInfoDrawerAtom } from "../atoms/AppAtoms";
import { Carousal } from "./Carousal";

export const Overview = () => {
    const toggleInfoDrawer = useSetAtom(toggleInfoDrawerAtom)
    const iconFontSize = 50;
    const iconColor = "rgba(108, 89, 217, 0.9)"

    // Variants for container animation
    const containerVariants: Variants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                delay: 0.5,
                duration: 1.5
            }
        },

    };

    // Variants for child animations
    const itemVariants: Variants = {
        hidden: { opacity: 0, y: 50 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                delay: 0.5,
                duration: 0.25,
                ease: "easeOut"
            }
        }
    };


    return (
        <section className="page-section" aria-label="Demo overview">
            <SpaceBetween size="m">
                <Container
                    header={
                        <Header info={<Link variant="info" onClick={toggleInfoDrawer}>Info</Link>} description={"A step-by-step guide for your exciting demo."}>Demo Overview</Header>
                    }>
                    <ColumnLayout columns={4} variant="text-grid">
                        <motion.div
                            initial={{
                                // x: 300,
                                y: -500,
                                opacity: 0
                            }}
                            animate={{
                                x: 0,
                                y: 0,
                                opacity: 1
                            }}
                            transition={{
                                // duration: 0.5,
                                delay: 0.15,
                                ease: "easeInOut"
                            }}
                            variants={containerVariants}
                            whileHover={{
                                scale: 1.1,
                            }}
                        >
                            <SpaceBetween size={"m"} direction="vertical">
                                <center>
                                    <FaAws fontSize={iconFontSize} color={iconColor} />
                                </center>
                                <TextContent>
                                    <center>
                                        <motion.div variants={itemVariants}>
                                            <h4>Step 1</h4>
                                            <p>This is a placeholder. You may tweak this or insert any <a href="https://cloudscape.design/components/">CloudScape components</a> here</p>
                                        </motion.div>
                                    </center>
                                </TextContent>
                            </SpaceBetween>
                        </motion.div>
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
                                // duration: 0.5,
                                delay: 0.15,
                                ease: "easeInOut"
                            }}
                            variants={containerVariants}
                            whileHover={{
                                scale: 1.1,
                            }}
                        >
                            <SpaceBetween size={"m"} direction="vertical">
                                <center>
                                    <PiSneakerMove fontSize={iconFontSize} color={iconColor} />
                                </center>
                                <TextContent>
                                    <center>
                                        <motion.div variants={itemVariants}>
                                            <h4>Step 2</h4>
                                            <p>We use <a href={"https://motion.dev/docs/react-quick-start"}>Framer Motion</a> library for animations. You can use it freely ac ross this application and animate any div.</p>
                                        </motion.div>
                                    </center>
                                </TextContent>
                            </SpaceBetween>
                        </motion.div>
                        <motion.div
                            initial={{
                                // x: 300,
                                y: -500,
                                opacity: 0
                            }}
                            animate={{
                                x: 0,
                                y: 0,
                                opacity: 1
                            }}
                            transition={{
                                // duration: 0.5,
                                delay: 0.15,
                                ease: "easeInOut"
                            }}
                            variants={containerVariants}
                            whileHover={{
                                scale: 1.1,

                            }}
                        >
                            <SpaceBetween size={"m"} direction="vertical">
                                <center>
                                    <PiMagicWandDuotone fontSize={iconFontSize} color={iconColor} />
                                </center>
                                <TextContent>
                                    <center>
                                        <motion.div variants={itemVariants}>
                                            <h4>Step 3</h4>
                                            <p>We use <a href={"https://react-icons.github.io/react-icons/"}>React Icons</a> for free low size icon library that has 1000s of popular icons.</p>
                                        </motion.div>
                                    </center>
                                </TextContent>
                            </SpaceBetween>
                        </motion.div>
                        <motion.div
                            initial={{
                                // x: 300,
                                y: -500,
                                opacity: 0
                            }}
                            animate={{
                                x: 0,
                                y: 0,
                                opacity: 1,

                            }}
                            transition={{
                                // duration: 0.5,
                                delay: 0.15,
                                ease: "easeInOut"
                            }}
                            variants={containerVariants}
                            whileHover={{
                                scale: 1.1,

                            }}
                        >
                            <SpaceBetween size={"m"} direction="vertical">
                                <center>
                                    <CiDatabase fontSize={iconFontSize} color={iconColor} />
                                </center>
                                <TextContent>
                                    <center>
                                        <motion.div variants={itemVariants}>
                                            <h4>Step 4</h4>
                                            <p>We use <a href={"https://jotai.org/"}>Jotai</a> for client side state management and <a href={"https://tanstack.com/query/latest/docs/framework/react/overview"}>React Query</a> for server side state management.</p>
                                        </motion.div>
                                    </center>
                                </TextContent>
                            </SpaceBetween>
                        </motion.div>
                    </ColumnLayout>
                </Container>

                <Container header={
                    <Header info={<Link variant="info" onClick={toggleInfoDrawer}>Info</Link>} description={"Show how your demo works. Here is an example of a carousal of images that is served directly from AWS S3."} >How It Works</Header>
                }>
                    <center>
                        <Carousal />
                    </center>
                    <TextContent>
                        <br />
                        <br />
                        <p>
                            This app has the ability to connect to AWS S3 data bucket configured in the bucket stack via AWS CDK deployments & interact with AWS S3 objects directly without the need of a Lambda function. We achieve this using the <Link href="https://docs.amplify.aws/gen1/react/build-a-backend/storage/">Amplify Storage Library</Link>
                        </p>

                        <ol>
                            <li>We use the <code>.env</code> file located in the <code>src</code> folder to get key AWS resource information such as ARN & IDs.</li>
                            <li>We then use the Amplify front end libraries to connect with several key services like Amazon Cognito, Amazon API Gateway, Amazon AppSync & Amazon S3.</li>
                            <li>Check out the <code>App.tsx</code> file to explore the <code>Amplify.configure</code> method.</li>
                            <li>You can read more <Link href="https://docs.amplify.aws/gen1/react/build-a-backend/storage/existing-resources/">here</Link>.</li>
                        </ol>
                        <p>
                            Use the CLI to create the hydration folder, copy files or folders to the newly created hydrate folder and use the CLI to upload the data bucket.
                        </p>
                        <p>
                            The Carousal images are placed in the <code>hydrate</code> folder located under <code>packages/webapp/src</code> folder. This folder cannot be checked in Git as it is meant to only to contain files that needs to be uploaded to the data bucket via the CLI.
                        </p>
                        <p>
                            Unlike the static files, these files usually need security credentials to access. Only authorized users can access the data bucket as its protected by the Amazon Cognito auth role & is also AWS KMS encrypted.
                        </p>
                        <br />
                        <h4>Hydration Steps</h4>
                        <ul>
                            <li>use the Kyber CLI and select Hydrate 🧼 option. This creates the <code>hydration</code> folder in <code>packages/webapp/src</code> folder</li>
                            <li>create a folder titled <code>carousal</code> under the <code>hydration</code> folder </li>
                            <li>place your desired image files. We support only PNGs/JPEGs at this time.</li>
                            <li>use the Kyber CLI and select Hydrate 🧼 option again. This will upload the images under the <code>carousal</code> folder</li>
                            <li>Serve the app or simply refresh the browser again</li>
                        </ul>
                    </TextContent>
                </Container>

                <Container header={
                    <Header info={<Link variant="info" onClick={toggleInfoDrawer}>Info</Link>} description={"Show how your demo architecture from AWS S3 static URL."} >Demo Architecture</Header>
                }>
                    <center>
                        <img alt={"arch"} src={`${import.meta.env.VITE_CONFIG_CLOUDFRONT_URL}/static/arch.png`}
                            width={"100%"} height={"100%"} />
                    </center>
                    <TextContent>
                        <br />
                        <br />
                        <ol>
                            <li>
                                The arch image is placed in the <code>static</code> folder located under <code>webapp/src/static/carousal</code> folder. You may easily swap these images here. You can also add more folders here to serve static content that get hosted on AWS S3 without impacting the webapp size.
                            </li>
                            <li>
                                Serving Static content will auto resolve Amazon CloudFront URL with a <code>static</code> prefix followed by the file name.
                            </li>
                            <li>
                                The <code>static</code> files are auto uploaded upon website deployment via CLI or via CI/CD.
                            </li>
                            <li>
                                Static file are usually images, icons, video and configuration files like JSON or XMLs that are too big in size to be checked in to Git. .
                            </li>
                        </ol>
                    </TextContent>
                </Container>
            </SpaceBetween>
        </section >
    )
}