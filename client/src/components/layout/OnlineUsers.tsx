import { useCollabStore } from '@/stores/collabStore';
import './OnlineUsers.css';

export default function OnlineUsers() {
  const users = useCollabStore((s) => s.onlineUsers);

  if (users.length === 0) return null;

  return (
    <div className="online-users">
      {users.map((u) => (
        <span
          key={u.clientId}
          className="online-users__avatar"
          style={{ backgroundColor: u.color }}
          title={u.name}
        >
          {u.name.charAt(0).toUpperCase()}
        </span>
      ))}
    </div>
  );
}
