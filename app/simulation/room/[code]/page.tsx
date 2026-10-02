import { notFound } from "next/navigation";
import RoomClient from "./RoomClient";

/** Invite codes only; nothing else ever reaches a realtime channel name. */
const ROOM_CODE = /^[A-Z0-9]{4,8}$/;

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const code = (await params).code.toUpperCase();
  if (!ROOM_CODE.test(code)) notFound();
  return <RoomClient code={code} />;
}
