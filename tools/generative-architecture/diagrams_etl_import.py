import re

from diagrams_class_list import diagrams_aws_libraries


def generate_imports(diagrams_aws_libraries):
    imports = []
    for line in diagrams_aws_libraries.split("\n"):
        if line.startswith("from"):
            continue

        match = re.match(r"(\w+) diagrams.aws.(\w+).(\w+)", line)
        if match:
            module = match.group(2)
            class_name = match.group(3)
            imports.append(f"from diagrams.aws.{module} import {class_name}")

    print("\n".join(imports))


generate_imports(diagrams_aws_libraries)
