import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    primaryColor: "#222222",
    primaryTextColor: "#ffffff",
    primaryBorderColor: "#888888",
    lineColor: "#00bcd4"
  }
});

export async function renderDiagram(code) {
  const { svg } = await mermaid.render(`flowchart-${Date.now()}`, code);
  return svg;
}
