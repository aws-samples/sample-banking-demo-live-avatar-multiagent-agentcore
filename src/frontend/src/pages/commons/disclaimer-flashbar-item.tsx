// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useId } from "react";

import { FlashbarProps } from "@cloudscape-design/components/flashbar";

export function useDisclaimerFlashbarItem(
    onDismiss: (id: string) => void
): FlashbarProps.MessageDefinition | null {
    const id = useId();

    return {
        type: "error",
        dismissible: true,
        dismissLabel: "Dismiss message",
        onDismiss: () => onDismiss(id),
        statusIconAriaLabel: "error",
        content: (
            <>
                <b>Urgent Equipment Issue (EXC-004)</b>
                <br />
                High coolant temperature (95°C) & low oil pressure (30 psi) detected on EXC-004.
                Immediate Inspection required!
            </>
        ),
        id,
    };
}
