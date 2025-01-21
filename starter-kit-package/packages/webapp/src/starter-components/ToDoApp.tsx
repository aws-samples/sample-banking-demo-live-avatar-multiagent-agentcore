import { Table, Pagination, Box, SpaceBetween, Header, Button, Link, Checkbox, Input, Grid, Spinner } from "@cloudscape-design/components"
import { useAtomValue, useSetAtom } from "jotai"
import { authedUserAtom, toggleInfoDrawerAtom } from "../atoms/AppAtoms"
import { addToDo, appsyncResolver, markToDo, useListToDo } from "../hooks/useApi"
import { useCallback, useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "react-toastify"
import { UpdateToDoInput } from "../API"
import { generateClient } from "aws-amplify/api"
import { onTaskByOwnerID } from "../graphql/subscriptions"

export const ToDoApp = () => {
    // amplify
    const client = generateClient();
    const authedUser = useAtomValue(authedUserAtom)
    const { data, isLoading, refetch } = useListToDo(authedUser?.userID ?? "")
    // set atoms
    const toggleInfoDrawer = useSetAtom(toggleInfoDrawerAtom)

    // states
    const [todo, setTodo] = useState("");

    const addToDoMutation = useMutation({
        mutationFn: async () => {
            if (authedUser?.userID) {
                return addToDo({
                    ownerID: authedUser?.userID ?? "",
                    title: todo,
                    completed: false
                })
            }
        },
        onSuccess: () => {
            toast.success("Todo Added")
        },
        onError: (error) => {
            toast.error("Error Adding Todo")
        },
        onSettled: () => {
            setTodo("")
            refetch()
        }
    })

    const updateToDoMutation = useMutation({
        mutationFn: async (input: UpdateToDoInput) => await markToDo({
            id: input.id,
            ownerID: input.ownerID,
            completed: input.completed
        }),
        onSuccess: () => {
            toast.success("Todo Updated")
        },
        onError: (error) => {
            toast.error("Error Updating Todo")
        },
        onSettled: () => {
            setTodo("")
            refetch()
        }
    })

    // trigger resolver function 
    const resolverFunctionMutation = useMutation({
        mutationFn: () => appsyncResolver(JSON.stringify({ opr: "todo", message: "Hello Resolver Lambda!" })),
        onSuccess: (data) => {
            console.log("🚀 ~ Demo ~ data:", data)
            toast.success("Resolver lambda triggered! Check Lambda Logs ;)")
        },
        onError: (error) => {
            console.log(error)
            toast.error("Error triggering resolver lambda")
        },
    })

    // listen for AppSync Subscription for your user ID only
    const sub = useCallback(
        () => {
            if (authedUser) {

                const createSub = client.graphql({
                    query: onTaskByOwnerID,
                    variables: {
                        ownerID: authedUser?.userID
                    }
                }).subscribe({
                    next: (data) => {
                        console.log(`🚀 ~ createSub:`, data.data.onTaskByOwnerID)
                        toast.info("Subscription triggered!")
                        refetch()
                    },
                    error: (err) => {
                        console.log(`🚀 ~ createSub:`, err)
                    },
                })
                return createSub
            }
        }, []
    )

    useEffect(() => {
        const todoSubscription = sub();
        return () => {
            if (todoSubscription) {
                console.log("🚀 ~ UN-SUBS ~ todoSubscription:");
                todoSubscription.unsubscribe()
            }
        }
    }, [])

    return (
        <Table
            renderAriaLive={({
                firstIndex,
                lastIndex,
                totalItemsCount
            }) =>
                `Displaying items ${firstIndex} to ${lastIndex} of ${totalItemsCount}`
            }
            columnDefinitions={[
                {
                    id: "id",
                    header: "ID",
                    cell: e => e.id,
                    sortingField: "id",
                    isRowHeader: true
                },
                {
                    id: "title",
                    header: "Title",
                    cell: e => e.title ?? "",
                    sortingField: "alt"
                },
                {
                    id: "completed",
                    header: "Status",
                    cell: e => <Checkbox
                        onChange={({ detail }) => {
                            console.log("🚀 ~ ToDoApp ~ detail:", detail.checked, e.id)
                            updateToDoMutation.mutate({
                                id: e.id,
                                ownerID: e.ownerID,
                                completed: detail.checked
                            })
                        }}
                        checked={e.completed ?? false}
                    />
                }
            ]}
            enableKeyboardNavigation
            key={"id"}
            items={isLoading ? [] : data || []}
            loading={isLoading}
            loadingText="Loading items"
            filter={
                <Grid gridDefinition={[{ colspan: 8 }, { colspan: 4 }]}>
                    <Input onChange={({ detail }) => setTodo(detail.value)}
                        value={todo}
                        onKeyDown={({ detail }) => {
                            if (detail.key === 'Enter' && !detail.shiftKey) {

                                if (authedUser?.userID)
                                    addToDoMutation.mutate()
                                else
                                    toast.error("Error Adding Todo")
                            }

                        }}
                        placeholder="Enter ToDo Item (e.g. - Use this Starter Kit, Learn Bedrock, ...)"
                        inputMode="text"
                    />
                    <SpaceBetween direction="horizontal" size="l" >
                        <Button disabled={addToDoMutation.isPending} iconName="close" onClick={() => setTodo("")} />
                        <Button disabled={todo.length < 3 || !authedUser}
                            loading={addToDoMutation.isPending}
                            variant="primary" iconName="add-plus" onClick={() => {
                                if (authedUser?.userID)
                                    addToDoMutation.mutate()
                                else
                                    toast.error("Error Adding Todo")
                            }}
                        >Add Item</Button>
                    </SpaceBetween>
                </Grid>
            }
            pagination={
                <Pagination currentPageIndex={1} pagesCount={2} />
            }
            empty={
                <Box
                    margin={{ vertical: "xs" }}
                    textAlign="center"
                    color="inherit"
                >
                    <SpaceBetween size="m">
                        <b>You are all caught up!</b>
                    </SpaceBetween>
                </Box>
            }

            header={<Header
                info={
                    <Link variant="info" onClick={toggleInfoDrawer}>Info</Link>} description={"Example of how we can manage a ToDo list with Amazon AppSync & DynamoDB without an intermediate Lambda function. Checkout real-time subscriptions on create/update ToDo."}
                actions={
                    <SpaceBetween
                        direction="horizontal"
                        size="xs"
                    >
                        <Button loading={resolverFunctionMutation.isPending} onClick={() => resolverFunctionMutation.mutate()} iconName="gen-ai">Trigger Resolver</Button>
                        <Button loading={isLoading} disabled={addToDoMutation.isPending} iconName="refresh" onClick={() => refetch()}>Refresh</Button>

                    </SpaceBetween>
                }
            >
                ToDo Items
            </Header>
            }

        />
    )
}
