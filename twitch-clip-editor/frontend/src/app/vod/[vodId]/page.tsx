"use client";

import { useEffect, useState } from "react";
import { VodEditorClient } from "./VodEditorClient";

type Props = {
  params: Promise<{ vodId: string }>;
};

export default function VodEditorPage({ params }: Props) {
  const [vodId, setVodId] = useState("");
  useEffect(() => {
    params.then((p) => setVodId(p.vodId));
  }, [params]);
  if (!vodId) return null;
  return <VodEditorClient vodId={vodId} />;
}
