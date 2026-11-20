# Best practicies code

Do a code review oriented best practicies with also DRY, KISS. Do not overengineer when possible. Refactor when relevant do not when it brings nearly no value. Ensure that code is a readable for humains maintenance with also a minimum of inline comments (not too much) to make it understandable. Last ensure docs folder is always maintained with mermaid / md documentation for all functional and technical aspects like also user guide or developer guides. Maintain consistency over the time. Update claude md guidance accordingly.

# testing

When doing testing do not over test, it bruns too much tokens. Test relevant part and do all test when major release or when asked or too long since not done. Also for test ensure mutation to check they bite really and are not allways green so not testing anything.

# Guidance with claude

Prepare guidance or eventual claude.md to put in each folder to guide claude to use better the tags engine. Do not overwrite existing claude files. Skip it

# Tag auto generation

Offer an integration with claude code to help user to generate tags automatically based on content. It should be based on file reading context of the folder and also eventual other existing tag already in the dictionnary

# Skills for claude to work with

# MCP to connect to obsidian ?