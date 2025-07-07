/* eslint-disable */
// @ts-nocheck

import { Box, ColumnLayout, Container, Header, Table, TextContent, SpaceBetween, Link } from "@cloudscape-design/components";

interface OutputGridProps {
    data: DataInterface;
}

enum Format {
    STRING = "STRING",
    ARRAY = "ARRAY",
    TABLE = "TABLE"
}

interface Column {
    attribute: string;
    header: string;
}

interface TableData {
    cols: Column[];
    rows: Record<string, any>[];
}

class DataInterface {
    format: Format;
    source: string;
    title?: string;
    data: string | DataInterface[] | TableData;

    constructor(format: Format, source: string, data: string | DataInterface[] | TableData, title?: string) {
        this.format = format;
        this.source = source;
        this.title = title;
        this.data = data;
    }

    static createString(source: string, data: string, title?: string): DataInterface {
        return new DataInterface(Format.STRING, source, data, title);
    }

    static createArray(source: string, data: DataInterface[], title?: string): DataInterface {
        return new DataInterface(Format.ARRAY, source, data, title);
    }

    static createTable(source: string, cols: Column[], rows: Record<string, any>[], title?: string): DataInterface {
        const data: TableData = { cols, rows };
        return new DataInterface(Format.TABLE, source, data, title);
    }
}


function getCleanUrl(url: string) {
    try {
        const urlObj = new URL(url);
        return urlObj.origin + urlObj.pathname;
    } catch {
        return url;
    }
}

function renderSourceLinks(source: string | string[]) {
    if (!source) return null;
    const sources = Array.isArray(source) ? source : [source];
    return (
        <div>
            {sources.map((url: string, idx: number) => (
                <span key={idx}>
                    <Link href={url} external>
                        {getCleanUrl(url)}
                    </Link>
                    {idx < sources.length - 1 && <br />}
                </span>
            ))}
        </div>
    );
}

function renderDataInterface(item: any, index: number): JSX.Element {
    if (!item) return null;

    // Handle DataInterface objects
    if (item.format) {
        const sourceDescription = renderSourceLinks(item.source);
        
        switch (item.format.toLowerCase()) {
            case 'table':
                return (
                    <Container
                        key={index}
                        header={
                            <SpaceBetween size="xs">
                                <Header variant="h3">{item.title}</Header>
                                {sourceDescription}
                            </SpaceBetween>
                        }
                    >
                        <Table
                            columnDefinitions={item.data.cols.map((col: any) => ({
                                id: col.attribute,
                                header: col.header,
                                cell: (row) => row[col.attribute],
                            }))}
                            wrapLines={true}
                            items={item.data.rows}
                            variant="embedded"
                        />
                    </Container>
                );
            
            case 'string':
                return (
                    <Container 
                        key={index}
                        header={
                            item.title ? (
                                <SpaceBetween size="xs">
                                    <Header variant="h3">{item.title}</Header>
                                    {sourceDescription}
                                </SpaceBetween>
                            ) : undefined
                        }
                    >
                        <TextContent>
                            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                                {item.data}
                            </pre>
                        </TextContent>
                    </Container>
                );
            
            case 'array':
                return (
                    <Container 
                        key={index}
                        variant={'inline'}
                        header={
                            item.title ? (
                                <SpaceBetween size="xs">
                                    <Header variant="h3">{item.title}</Header>
                                    {sourceDescription}
                                </SpaceBetween>
                            ) : undefined
                        }
                    >
                        <ColumnLayout columns={Math.min(item.data.length, 2)}>
                            {item.data.map((subItem: any, subIndex: number) =>
                                renderDataInterface(subItem, subIndex)
                            )}
                        </ColumnLayout>
                    </Container>

                );
        }
    }

    // Legacy format handling
    if (typeof item === 'string') {
        return (
            <Container key={index}>
                <TextContent>
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                        {item}
                    </pre>
                </TextContent>
            </Container>
        );
    }

    if (item.data && item.data.cols && item.data.rows) {
        const sourceDescription = renderSourceLinks(item.source);
        return (
            <Container
                key={index}
                header={
                    <SpaceBetween size="xs">
                        <Header variant="h3">{item.title}</Header>
                        {sourceDescription}
                    </SpaceBetween>
                }
            >
                <Table
                    columnDefinitions={item.data.cols.map((col: any) => ({
                        id: col.attribute,
                        header: col.header,
                        cell: (row) => row[col.attribute],
                    }))}
                    wrapLines={true}
                    items={item.data.rows}
                    variant="embedded"
                />
            </Container>
        );
    }

    return null;
}

export default function OutputGrid({ data }: OutputGridProps) {

    if (!data) {
        return <Container><TextContent>No output available</TextContent></Container>;
    }

    return renderDataInterface(data, 0) || (
        <Box>
            <TextContent>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                    {JSON.stringify(data, null, 2)}
                </pre>
            </TextContent>
        </Box>
    );
}