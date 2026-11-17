# Use your brand

Give the AI a website address or a brand guide (PDF, image or CSS file) and ask for diagrams in that look. It extracts colours, font, corner style and icon weight, checks contrast in light and dark mode, and shows you the report and three preview images. Nothing is kept until you accept it.

Text stays readable: the colours are checked against WCAG 2.2 AA contrast in light and dark mode, and any that fall short are nudged until they pass.

Example prompts:

- *"Use the brand from https://example.com and draw a swimlane flowchart of our loan approval process."*
- *"Here is our brand guide (brand.pdf). Make diagrams in this style, then draw a sequence diagram of the login flow."*

Once accepted, the theme is saved as `.ultimate-diagram/theme.json` in your project and every later diagram there uses it; diagrams you already saved pick it up the next time they are re-laid out. To switch back, delete that file.

For contributors: [references/theme.md](../references/theme.md).
