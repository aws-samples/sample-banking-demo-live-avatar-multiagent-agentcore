"""
This script takes the string of AWS diagram classes from diagrams_class_list.py,
removes the newlines, writes the string to a text file, and prints the string.

It can be used to get a condensed list of AWS diagram classes for reference.
"""

from diagrams_class_list import diagrams_aws_libraries

# Replace newlines with spaces
no_newlines = diagrams_aws_libraries.replace("\n", " ")

# Open file for writing
with open("diagrams_aws_libraries_no_newlines.txt", "w") as f:
    # Write string without newlines to file
    f.write(no_newlines)

# Print string without newlines
print(no_newlines)
