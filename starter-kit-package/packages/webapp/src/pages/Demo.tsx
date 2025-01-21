import { Button, Container, ContentLayout, Header, Link, SpaceBetween } from "@cloudscape-design/components"
import { useSetAtom } from "jotai/react"
import { toggleInfoDrawerAtom } from "../atoms/AppAtoms"
import { postHTTP, postRest, } from "../hooks/useApi"
import { toast } from "react-toastify"
import { list } from "aws-amplify/storage"
import { S3List } from "../starter-components/S3List"
import { ToDoApp } from "../starter-components/ToDoApp"


export const Demo = () => {
    // set atoms
    const toggleInfoDrawer = useSetAtom(toggleInfoDrawerAtom)

    // calls Python lambda
    const handleRestAPI = async () => {
        try {
            const resp = await postRest()
            console.log("🚀 ~ handleRestAPI ~ resp:", resp)
            toast.success(`Rest API says - ${JSON.stringify(resp)}`)
        } catch (error) {
            console.error("🚀 ~ handleRestAPI ~ error:", error)
            toast.error("Error calling Rest API")

        }
    }

    // calls Typescript lambda
    const handleHttpAPI = async () => {
        try {
            const resp = await postHTTP()
            console.log("🚀 ~ handleHttpAPI ~ resp:", resp)
            toast.success(`HTTP API says - ${JSON.stringify(resp)}`)
        } catch (error) {
            console.error("🚀 ~ handleHttpAPI ~ error:", error)
            toast.error("Error calling HTTP API")

        }
    }

    return (
        <ContentLayout
            header={
                <Header
                    variant="h1"
                    info={<Link variant="info" onClick={toggleInfoDrawer}>Info</Link>}
                    description="This is a mock demo page that showcases integrations with API Gateway, AppSync & AWS S3."
                    actions={
                        <SpaceBetween direction="horizontal" size="m">
                            <Button onClick={handleHttpAPI} variant="normal">Test HTTP API </Button>
                            <Button onClick={handleRestAPI} variant="normal">Test Rest API </Button>
                        </SpaceBetween>
                    }
                >
                    Demo Application
                </Header>}
        >
            <SpaceBetween size={"m"} direction="vertical">
                <S3List />
                <ToDoApp />
            </SpaceBetween>
        </ContentLayout>
    )
}