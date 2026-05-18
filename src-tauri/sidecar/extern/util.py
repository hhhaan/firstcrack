#
# ABOUT
# Artisan Utilities

# LICENSE
# This program or module is free software: you can redistribute it and/or
# modify it under the terms of the GNU General Public License as published
# by the Free Software Foundation, either version 2 of the License, or
# version 3 of the License, or (at your option) any later version. It is
# provided for educational purposes and is distributed in the hope that
# it will be useful, but WITHOUT ANY WARRANTY; without even the implied
# warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See
# the GNU General Public License for more details.

# AUTHOR
# Marko Luther, 2023

import codecs
from typing import Any


def encodeLocalStrict(x: Any | None, default: str = "") -> str:
    if x is None:
        return default
    try:
        return codecs.unicode_escape_encode(str(x))[0].decode("utf8")
    except Exception:
        return default
