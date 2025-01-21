import { Box, Button, Container, ContentLayout, Grid, SpaceBetween } from "@cloudscape-design/components";
import { post } from 'aws-amplify/api';
import { fetchAuthSession } from "aws-amplify/auth";
import { list } from 'aws-amplify/storage';
import HeroHeader from "../assets/hero_header_web.jpeg"
import { useNavigate } from "react-router-dom";
import { AppRoutes } from "./PageNavigation";
import { Overview } from "../starter-components/Overview";

export const Home = () => {
    const navigate = useNavigate();


    return (
        <ContentLayout
            headerVariant="high-contrast"
            defaultPadding
            headerBackgroundStyle={mode =>
                `center center/cover url(${HeroHeader})`
            }
            header={
                <div style={{
                    width: "80vw",
                    paddingTop: "2%",
                    paddingBottom: "2%",
                    borderRadius: "5vw",
                }}  >
                    <Grid
                        gridDefinition={[
                            { colspan: { default: 12, s: 8 } }
                        ]}
                    >
                        <Container>
                            <SpaceBetween size="xs">
                                <Box
                                    fontSize="display-l"
                                    fontWeight="bold"
                                    variant="h1"
                                    padding="n"
                                > Gen-AI Labs Demo Starter Kit
                                </Box>
                                <Box
                                    variant="p"
                                    color="text-body-secondary"
                                    margin={{ top: "xs", bottom: "l" }}
                                >
                                    Welcome to the demo React app.
                                </Box>
                                <SpaceBetween
                                    direction="horizontal"
                                    size="xs"
                                >
                                    <Button variant="primary" onClick={() => navigate(AppRoutes.demo.href)}>
                                        Launch Demo
                                    </Button>
                                    <Button onClick={() => {
                                        // redirect else where
                                        window.open("https://aws.amazon.com/", "_blank", "noopener,noreferrer");
                                    }}>
                                        Explore how it works
                                    </Button>
                                </SpaceBetween>
                            </SpaceBetween>
                        </Container>
                    </Grid>
                </div>
            }
        >
            <main>
                <Overview />
            </main>
        </ContentLayout>
    )

}