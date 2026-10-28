"""Build a derived JSON-only source view; immutable source bytes remain untouched."""

from lxml import html


def prepare_source_view(source: bytes, encoding: str, segments: list[tuple]) -> dict:
    source.decode(encoding)
    document = html.document_fromstring(source, parser=html.HTMLParser(encoding=encoding))
    for element in document.iter():
        if not isinstance(element.tag, str):
            continue
        # Only server-generated IDs are used for parent-driven source navigation.
        element.attrib.pop("id", None)
        element.attrib.pop("name", None)
        element.attrib.pop("class", None)
    anchors = {}
    for segment_id, xpath in segments:
        targets = document.xpath(xpath)
        if len(targets) != 1 or not isinstance(targets[0], html.HtmlElement):
            raise ValueError("source_location_mismatch")
        element = targets[0]
        anchor = element.get("id")
        if anchor is None:
            anchor = "source-" + str(segment_id)
            element.set("id", anchor)
        anchors[str(segment_id)] = anchor
    body = document.find("body")
    return {
        "html": html.tostring(body if body is not None else document, encoding="unicode"),
        "anchors": anchors,
        "view_kind": "derived",
    }
