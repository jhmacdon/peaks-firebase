import { LOADING_LABEL } from "../../../../lib/constants";

export default function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-gray-500">{LOADING_LABEL}</div>
    </div>
  );
}
