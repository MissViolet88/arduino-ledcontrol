create table
    public.traffic_logs (
        id serial not null,
        event text not null,
        created_at timestamp
        with
            time zone null default now (),
            constraint traffic_logs_pkey primary key (id)
    ) TABLESPACE pg_default;