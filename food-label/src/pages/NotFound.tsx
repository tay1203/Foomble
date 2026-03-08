import { Link } from "react-router-dom";

const NotFound: React.FC = () => {
    return (
        <div>404 Not Found
            <Link to="/">Home</Link>
        </div>
    );
}

export default NotFound;