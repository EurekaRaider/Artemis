import { useEffect, useRef, useState } from "react";
import { IconButton } from "@artemis/ui/actions";
import { Tabs, type TabsProps } from "@artemis/ui/navigation";

export function MarketplaceTabs(props: TabsProps<string>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const tabs = root?.querySelector<HTMLElement>('[role="tablist"]');
    if (!root || !tabs) return;
    const measure = () => setOverflow(tabs.scrollWidth > root.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(tabs);
    measure();
    return () => observer.disconnect();
  }, [props.options]);

  useEffect(() => {
    rootRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.value]);

  const scroll = (direction: -1 | 1) => {
    const tabs =
      rootRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    if (!tabs) return;
    tabs.scrollBy({ left: direction * tabs.clientWidth * 0.75 });
  };

  return (
    <div className="resource-marketplace-tabs" ref={rootRef}>
      {overflow && (
        <IconButton
          label={`${props.label} ←`}
          className="resource-tab-scroll"
          disabled={props.disabled}
          onClick={() => scroll(-1)}
          icon="←"
          size="compact"
        />
      )}
      <Tabs {...props} className="resource-scope-tabs" />
      {overflow && (
        <IconButton
          label={`${props.label} →`}
          className="resource-tab-scroll"
          disabled={props.disabled}
          onClick={() => scroll(1)}
          icon="→"
          size="compact"
        />
      )}
    </div>
  );
}
