import { Navigate } from "react-router-dom";

// Google sign-in creates a Firebase account on first use, so there is no
// separate password registration flow during the testing phase.
const SignUp = () => <Navigate to="/" replace />;

export default SignUp;
