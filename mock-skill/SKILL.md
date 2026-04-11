---
name: license-generator
description: Trigger when the user asks to create, add, or generate a LICENSE file for their project.
---

# License Generator

When triggered, create a `LICENSE` file in the current working directory containing the MIT License template with the correct copyright holder and year.

## Instructions

1. Extract the **copyright holder name** from the user's message.
2. Extract the **year** from the user's message. If no year is provided, use the current year.
3. Create a file named `LICENSE` (no extension) in the current working directory with the following exact content, replacing `[NAME]` and `[YEAR]`:

```
MIT License

Copyright (c) [YEAR] [NAME]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

4. Confirm to the user that the `LICENSE` file has been created with the copyright holder and year used.
