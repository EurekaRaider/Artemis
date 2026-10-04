// Displacement assets from the v143 sidebar handoff. Keep the map aligned to
// the element within the SVG filter's default -10% / 120% region.
const railMap =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='48'%20height='672'%3E%3Cdefs%3E%3ClinearGradient%20id='L'%20x1='0'%20y1='0'%20x2='1'%20y2='0'%3E%3Cstop%20offset='0'%20stop-color='rgb(0,128,128)'/%3E%3Cstop%20offset='1'%20stop-color='rgb(128,128,128)'/%3E%3C/linearGradient%3E%3ClinearGradient%20id='R'%20x1='0'%20y1='0'%20x2='1'%20y2='0'%3E%3Cstop%20offset='0'%20stop-color='rgb(128,128,128)'/%3E%3Cstop%20offset='1'%20stop-color='rgb(255,128,128)'/%3E%3C/linearGradient%3E%3ClinearGradient%20id='T'%20x1='0'%20y1='0'%20x2='0'%20y2='1'%3E%3Cstop%20offset='0'%20stop-color='rgb(128,0,128)'/%3E%3Cstop%20offset='1'%20stop-color='rgb(128,128,128)'/%3E%3C/linearGradient%3E%3ClinearGradient%20id='B'%20x1='0'%20y1='0'%20x2='0'%20y2='1'%3E%3Cstop%20offset='0'%20stop-color='rgb(128,128,128)'/%3E%3Cstop%20offset='1'%20stop-color='rgb(128,255,128)'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width='48'%20height='672'%20fill='rgb(128,128,128)'/%3E%3Crect%20width='16'%20height='672'%20fill='url(%23L)'/%3E%3Crect%20x='32'%20width='16'%20height='672'%20fill='url(%23R)'/%3E%3Crect%20width='48'%20height='16'%20fill='url(%23T)'/%3E%3Crect%20y='656'%20width='48'%20height='16'%20fill='url(%23B)'/%3E%3C/svg%3E";
const drawerMap =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='260'%20height='672'%3E%3Cdefs%3E%3ClinearGradient%20id='L'%20x1='0'%20y1='0'%20x2='1'%20y2='0'%3E%3Cstop%20offset='0'%20stop-color='rgb(0,128,128)'/%3E%3Cstop%20offset='1'%20stop-color='rgb(128,128,128)'/%3E%3C/linearGradient%3E%3ClinearGradient%20id='R'%20x1='0'%20y1='0'%20x2='1'%20y2='0'%3E%3Cstop%20offset='0'%20stop-color='rgb(128,128,128)'/%3E%3Cstop%20offset='1'%20stop-color='rgb(255,128,128)'/%3E%3C/linearGradient%3E%3ClinearGradient%20id='T'%20x1='0'%20y1='0'%20x2='0'%20y2='1'%3E%3Cstop%20offset='0'%20stop-color='rgb(128,0,128)'/%3E%3Cstop%20offset='1'%20stop-color='rgb(128,128,128)'/%3E%3C/linearGradient%3E%3ClinearGradient%20id='B'%20x1='0'%20y1='0'%20x2='0'%20y2='1'%3E%3Cstop%20offset='0'%20stop-color='rgb(128,128,128)'/%3E%3Cstop%20offset='1'%20stop-color='rgb(128,255,128)'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width='260'%20height='672'%20fill='rgb(128,128,128)'/%3E%3Crect%20width='18'%20height='672'%20fill='url(%23L)'/%3E%3Crect%20x='242'%20width='18'%20height='672'%20fill='url(%23R)'/%3E%3Crect%20width='260'%20height='18'%20fill='url(%23T)'/%3E%3Crect%20y='654'%20width='260'%20height='18'%20fill='url(%23B)'/%3E%3C/svg%3E";

export function SidebarGlassFilters() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute" }}
    >
      <defs>
        {[
          { id: "railGlass", map: railMap, frost: 1.6 },
          { id: "drawerGlass", map: drawerMap, frost: 6.5 },
          { id: "panelGlass", map: drawerMap, frost: 6.5 },
        ].map(({ id, map, frost }) => (
          <filter key={id} id={id} colorInterpolationFilters="sRGB">
            <feImage
              href={map}
              preserveAspectRatio="none"
              result="map"
              x="8.3333%"
              y="8.3333%"
              width="83.3334%"
              height="83.3334%"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              result="displaced"
              scale="22"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feGaussianBlur
              in="displaced"
              result="frost"
              stdDeviation={frost}
            />
            <feComponentTransfer in="frost">
              <feFuncR type="table" tableValues="0.04 1" />
              <feFuncG type="table" tableValues="0.04 1" />
              <feFuncB type="table" tableValues="0.04 1" />
            </feComponentTransfer>
          </filter>
        ))}
      </defs>
    </svg>
  );
}
