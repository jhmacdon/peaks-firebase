/**
 * Popup DOM builders for map components. Destination and route fields come
 * from imported or admin-edited data, so they must land in the DOM as text —
 * never as interpolated HTML.
 */

/**
 * Leaflet renders string popup content as HTML, so plain-text popups must go
 * through a DOM node.
 */
export function textPopup(text: string): HTMLElement {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
}

export function destinationPopup(dest: {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
}): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.style.minWidth = "140px";

  const title = document.createElement("div");
  title.textContent = dest.name || "Unnamed";
  title.style.fontWeight = "600";
  title.style.marginBottom = "4px";
  wrapper.append(title);

  if (dest.elevation != null) {
    const elevation = document.createElement("div");
    elevation.textContent = `${Math.round(dest.elevation * 3.28084).toLocaleString()} ft`;
    elevation.style.fontSize = "12px";
    elevation.style.color = "#666";
    wrapper.append(elevation);
  }

  if (dest.features.length > 0) {
    const features = document.createElement("div");
    features.textContent = dest.features.join(", ");
    features.style.fontSize = "11px";
    features.style.color = "#888";
    features.style.marginTop = "2px";
    wrapper.append(features);
  }

  wrapper.append(
    popupLink(`/destinations/${encodeURIComponent(dest.id)}`, "View Details", "6px")
  );

  return wrapper;
}

export function routePopup(route: { id: string; name: string }): HTMLElement {
  const wrapper = document.createElement("div");

  const title = document.createElement("div");
  title.textContent = route.name;
  title.style.fontWeight = "600";
  wrapper.append(title);

  wrapper.append(popupLink(`/routes/${encodeURIComponent(route.id)}`, "View Route", "4px"));

  return wrapper;
}

function popupLink(href: string, label: string, marginTop: string): HTMLElement {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  link.style.display = "inline-block";
  link.style.marginTop = marginTop;
  link.style.fontSize = "12px";
  link.style.color = "#2563eb";
  link.style.textDecoration = "none";
  return link;
}
