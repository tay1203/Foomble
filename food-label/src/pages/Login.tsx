import React, { useState, useRef, useEffect } from "react";
import {
  useForm,
  Controller,
  FormProvider,
  useFormContext,
} from "react-hook-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/ui/layout";
import { NavLink } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import GoogleIcon from "@/assets/google-icon-logo.svg";

const loginSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(25, "Password must be less than 25 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const Login: React.FC = () => {
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = (values: LoginFormValues) => {
    console.log("Form submitted successfully", values);
  };

  return (
    <Layout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Login</CardTitle>
        </CardHeader>
        <CardContent className="w-full">
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup className="w-full">
              <Controller
                name="email"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input
                      {...field}
                      id="email"
                      type="email"
                      placeholder="Enter your email"
                      required
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="password"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <div className="flex items-center">
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <div className="ml-auto inline-block text-sm underline-offset-4 hover:underline">
                        <NavLink to={`forgot-password`}>
                          Forgot Password?
                        </NavLink>
                      </div>
                    </div>
                    <Input
                      {...field}
                      id="password"
                      type="password"
                      autoComplete="off"
                      required
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full">
            Login
          </Button>
          <Button variant="outline" className="w-full gap-2">
            <img src={GoogleIcon} alt="Google" className="w-4 h-4"/>
            Login with Google
          </Button>
          <div className="underline-offset-4 hover:underline">
            <NavLink to={`\signup`}>Don't have an account? Sign Up</NavLink>
          </div>
        </CardFooter>
      </Card>
    </Layout>
  );
};

export default Login;
