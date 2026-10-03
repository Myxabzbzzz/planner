import { Component, type ReactNode } from "react";
import { FullScreenMessage } from "./States";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <FullScreenMessage title="Что-то пошло не так" hint="Перезапусти миниапп" />;
    return this.props.children;
  }
}
