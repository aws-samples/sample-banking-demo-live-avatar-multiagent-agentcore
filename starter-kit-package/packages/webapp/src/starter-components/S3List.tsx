import { Table, Box, SpaceBetween, Button, TextFilter, Header, Pagination, Link } from "@cloudscape-design/components";
import { useListDataBucket } from "../hooks/useStorage";
import { toggleInfoDrawerAtom } from "../atoms/AppAtoms";
import { useSetAtom } from "jotai/react";

export const S3List = () => {
    const { data, isLoading, refetch } = useListDataBucket()
    // set atoms
    const toggleInfoDrawer = useSetAtom(toggleInfoDrawerAtom)
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
                    id: "etag",
                    header: "ID",
                    cell: e => e.eTag,
                    sortingField: "name",
                    isRowHeader: true
                },
                {
                    id: "prefix",
                    header: "Item Prefix",
                    cell: e => e.path,
                    sortingField: "alt"
                },
                { id: "size", header: "Size", cell: e => e.size },
                {
                    id: "lastModified",
                    header: "Last Modified",
                    cell: e => e.lastModified?.toLocaleDateString() ?? "N/A"
                }
            ]}
            enableKeyboardNavigation
            items={isLoading ? [] : data || []}
            loading={isLoading}
            loadingText="Loading items"
            filter={
                <TextFilter
                    filteringPlaceholder="Find resources"
                    filteringText=""
                />
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
                        <b>Bucket Empty!</b>
                    </SpaceBetween>
                </Box>
            }

            header={<Header
                info={
                    <Link variant="info" onClick={toggleInfoDrawer}>Info</Link>} description={"Example of how we can list all items in the Data Bucket without an intermediate Lambda function."}
                actions={
                    <SpaceBetween
                        direction="horizontal"
                        size="xs"
                    >
                        <Button iconName="refresh" onClick={() => refetch()} />
                    </SpaceBetween>
                }
            >
                Data Bucket Items
            </Header>
            }

        />
    )
}  