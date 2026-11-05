let wakeHandler = null;

export function registerMeetWorkerWakeHandler(handler) {
  if (typeof handler !== "function") {
    throw new TypeError("Meet worker wake handler must be a function.");
  }

  wakeHandler = handler;

  return () => {
    if (wakeHandler === handler) {
      wakeHandler = null;
    }
  };
}

export function wakeMeetWorker() {
  if (wakeHandler) {
    wakeHandler();
    return true;
  }

  return false;
}